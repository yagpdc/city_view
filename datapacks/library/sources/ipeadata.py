"""Ipeadata (IPEA): séries macroeconômicas, sociais e regionais.

A API OData do Ipeadata devolve só a série inteira (não filtra por nível ou data), então o
índice usa apenas os metadados: séries da base "Regional" têm recorte territorial (estados,
municípios…) e são marcadas como regionais; se há município, o adaptador descobre ao baixar.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import DOWNLOAD, REGIONAL, Interner, get_json, write_source, year  # noqa: E402

API = "https://www.ipeadata.gov.br/api/odata4"


def build() -> None:
    series = get_json(f"{API}/Metadados", timeout=180)["value"]
    themes = {t["TEMCODIGO"]: t["TEMNOME"] for t in get_json(f"{API}/Temas")["value"]}

    groups = Interner()
    subjects = Interner()
    items = []
    for s in sorted(series, key=lambda s: (s.get("BASNOME") or "", s["SERNOME"])):
        if s.get("SERSTATUS") not in (None, "A"):  # "I" = inativa
            continue
        base = s.get("BASNOME") or "Outras"
        flags = DOWNLOAD | (REGIONAL if base.startswith("Regional") else 0)
        title = s["SERNOME"]
        unit = (s.get("UNINOME") or "").strip()
        if unit and unit != "-":
            title = f"{title} ({unit})"
        items.append([
            s["SERCODIGO"],
            title,
            groups(base, {"id": base, "name": base}),
            subjects(themes.get(s.get("TEMCODIGO"), "")),
            None,
            year(s.get("SERATUALIZACAO")),
            flags,
        ])

    write_source(
        {
            "id": "ipeadata",
            "name": "Ipeadata",
            "publisher": "IPEA",
            "country": "BR",
            "description": "Séries do Instituto de Pesquisa Econômica Aplicada: macroeconomia, indicadores sociais e dados regionais por estado e município.",
            "homepage": "https://www.ipeadata.gov.br",
            # Sem página por série com endereço estável: o link leva aos metadados oficiais da série.
            "itemUrl": "https://www.ipeadata.gov.br/api/odata4/Metadados('{id}')",
            "license": "Dados públicos do IPEA: uso livre com citação da fonte (e da fonte primária de cada série)",
            "adapter": "ipeadata",
            "groupLabel": "Base",
        },
        groups.values,
        subjects.values,
        items,
    )


if __name__ == "__main__":
    build()
