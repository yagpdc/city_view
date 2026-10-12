"""Gera o catálogo de referência das tabelas do SIDRA (IBGE).

Só metadados e links: o usuário encontra a tabela na plataforma e baixa no site do IBGE.
Saída: datapacks/references/sidra.json (versionado — é pequeno e é só índice).

Uso:
  python datapacks/references/build_sidra.py              # lista + metadados (com cache)
  python datapacks/references/build_sidra.py --sem-detalhes

Os metadados (anos, assunto, níveis territoriais) vêm de uma consulta por tabela; ficam em
cache em data/cache/sidra/ para a próxima execução só buscar o que mudou ou faltou.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "sidra.json"
CACHE = ROOT.parent.parent / "data" / "cache" / "sidra"
API = "https://servicodados.ibge.gov.br/api/v3/agregados"
GZIP_MAGIC = bytes([0x1F, 0x8B])
# Poucas consultas simultâneas: a API é pública e gratuita.
WORKERS = 10


def get_json(url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "city_view-references/0.1", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            return json.loads(gzip.decompress(data) if data[:2] == GZIP_MAGIC else data)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def metadata(table_id: int) -> dict | None:
    cached = CACHE / f"{table_id}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    try:
        meta = get_json(f"{API}/{table_id}/metadados")
    except Exception:
        return None
    levels = meta.get("nivelTerritorial") or {}
    period = meta.get("periodicidade") or {}
    slim = {
        "assunto": meta.get("assunto") or "",
        "inicio": period.get("inicio"),
        "fim": period.get("fim"),
        "frequencia": period.get("frequencia") or "",
        "municipal": "N6" in (levels.get("Administrativo") or []),
    }
    cached.write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")
    return slim


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sem-detalhes", action="store_true", help="só a lista (sem anos/assunto/níveis)")
    args = parser.parse_args()

    surveys = sorted(get_json(API), key=lambda s: s["nome"])
    entries = [(int(t["id"]), t["nome"], i) for i, s in enumerate(surveys) for t in s["agregados"]]
    entries.sort(key=lambda e: (e[2], e[0]))

    details: dict[int, dict | None] = {}
    if not args.sem_detalhes:
        CACHE.mkdir(parents=True, exist_ok=True)
        done = 0
        with ThreadPoolExecutor(WORKERS) as pool:
            for table_id, meta in zip((e[0] for e in entries), pool.map(metadata, (e[0] for e in entries))):
                details[table_id] = meta
                done += 1
                if done % 500 == 0:
                    print(f"[sidra] metadados {done}/{len(entries)}", flush=True)

    subjects: list[str] = []
    subject_index: dict[str, int] = {}

    def subject(name: str) -> int:
        if not name:
            return -1
        if name not in subject_index:
            subject_index[name] = len(subjects)
            subjects.append(name)
        return subject_index[name]

    def year(v):
        """Períodos mensais/trimestrais vêm como 200212 ou 20231; fica só o ano."""
        if not v:
            return None
        v = int(v)
        while v > 9999:
            v //= 10
        return v

    tables = []
    for table_id, name, s in entries:
        d = details.get(table_id)
        if d:
            # [id, nome, pesquisa, assunto, ano inicial, ano final, tem municípios]
            tables.append([table_id, name, s, subject(d["assunto"]), year(d["inicio"]), year(d["fim"]), 1 if d["municipal"] else 0])
        else:
            tables.append([table_id, name, s, -1, None, None, 0])

    catalog = {
        "source": "IBGE — SIDRA (Sistema IBGE de Recuperação Automática)",
        "sourceUrl": "https://sidra.ibge.gov.br",
        "tableUrl": "https://sidra.ibge.gov.br/tabela/{id}",
        "license": "Dados públicos do IBGE: uso livre com citação da fonte",
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "surveys": [{"id": s["id"], "name": s["nome"], "count": len(s["agregados"])} for s in surveys],
        "subjects": subjects,
        "tables": tables,
    }
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with_meta = sum(1 for t in tables if t[3] != -1 or t[4] is not None)
    print(f"[sidra] {len(tables)} tabelas ({with_meta} com metadados) de {len(surveys)} pesquisas -> {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
