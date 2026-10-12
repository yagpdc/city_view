"""IBGE · SIDRA: todas as tabelas, com pesquisa, assunto, anos e recortes territoriais.

Uma consulta por tabela para os metadados (cache em data/cache/library/ibge-sidra/,
retomável). Use --sem-detalhes para só a lista.
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import CACHE, DOWNLOAD, Blocked, MUNICIPAL, POLITE_WORKERS, REGIONAL, Interner, get_json, write_source, year  # noqa: E402

API = "https://servicodados.ibge.gov.br/api/v3/agregados"
CACHE_DIR = CACHE / "ibge-sidra"
WORKERS = POLITE_WORKERS  # coleta educada (ver common.py)
# Mesmos recortes que o adaptador do front sabe baixar.
ADMIN_LEVELS = {"N6", "N3", "N2", "N1"}


def metadata(table_id: int) -> dict | None:
    cached = CACHE_DIR / f"{table_id}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    try:
        meta = get_json(f"{API}/{table_id}/metadados", timeout=60)
    except Blocked:
        raise  # a fonte pediu para parar: interrompe a coleta inteira
    except Exception:
        return None  # falha pontual de uma tabela: segue sem os detalhes dela
    levels = meta.get("nivelTerritorial") or {}
    period = meta.get("periodicidade") or {}
    slim = {
        "assunto": meta.get("assunto") or "",
        "inicio": period.get("inicio"),
        "fim": period.get("fim"),
        "niveis": levels.get("Administrativo") or [],
    }
    cached.write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
    return slim


def build(details: bool = True) -> None:
    surveys = sorted(get_json(API), key=lambda s: s["nome"])
    entries = sorted(((int(t["id"]), t["nome"], i) for i, s in enumerate(surveys) for t in s["agregados"]), key=lambda e: (e[2], e[0]))

    metas: dict[int, dict | None] = {}
    if details:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(WORKERS) as pool:
            for n, (tid, meta) in enumerate(zip((e[0] for e in entries), pool.map(metadata, (e[0] for e in entries))), 1):
                metas[tid] = meta
                if n % 1000 == 0:
                    print(f"[ibge-sidra] metadados {n}/{len(entries)}", flush=True)

    subjects = Interner()
    items = []
    for tid, name, g in entries:
        m = metas.get(tid) or {}
        levels = set(m.get("niveis", []))
        flags = (MUNICIPAL if "N6" in levels else 0) | (REGIONAL if levels & {"N2", "N3"} else 0)
        if levels & ADMIN_LEVELS:
            flags |= DOWNLOAD
        items.append([str(tid), name, g, subjects(m.get("assunto")), year(m.get("inicio")), year(m.get("fim")), flags])

    write_source(
        {
            "id": "ibge-sidra",
            "name": "IBGE · SIDRA",
            "publisher": "IBGE",
            "country": "BR",
            "description": "Sistema IBGE de Recuperação Automática: tabelas do Censo, PNAD, PIB dos municípios, pesquisas agropecuárias e muitas outras.",
            "homepage": "https://sidra.ibge.gov.br",
            "itemUrl": "https://sidra.ibge.gov.br/tabela/{id}",
            "license": "Dados públicos do IBGE: uso livre com citação da fonte",
            "adapter": "sidra",
            "groupLabel": "Pesquisa",
        },
        [{"id": s["id"], "name": s["nome"]} for s in surveys],
        subjects.values,
        items,
    )


if __name__ == "__main__":
    build(details="--sem-detalhes" not in sys.argv)
