"""Formato comum dos índices da biblioteca (ver docs/LIBRARY.md)."""

from __future__ import annotations

import datetime as dt
import gzip
import json
import time
import urllib.request
from pathlib import Path

LIBRARY = Path(__file__).resolve().parent
CACHE = LIBRARY.parent.parent / "data" / "cache" / "library"
SCHEMA = 1
GZIP_MAGIC = bytes([0x1F, 0x8B])

# Bits de capacidade de cada item.
MUNICIPAL = 1
REGIONAL = 2
DOWNLOAD = 4


def get_json(url: str, retries: int = 3, timeout: int = 90):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "city_view-library/0.1", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            return json.loads(gzip.decompress(data) if data[:2] == GZIP_MAGIC else data)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def year(value) -> int | None:
    """Ano a partir de 2022, '2022-01-01…', 202212 (mês) ou 20231 (trimestre)."""
    if value in (None, ""):
        return None
    if isinstance(value, str):
        digits = value[:4]
        return int(digits) if digits.isdigit() else None
    v = int(value)
    while v > 9999:
        v //= 10
    return v


class Interner:
    def __init__(self) -> None:
        self.values: list = []
        self.index: dict = {}

    def __call__(self, key, value=None) -> int:
        if key in (None, ""):
            return -1
        if key not in self.index:
            self.index[key] = len(self.values)
            self.values.append(value if value is not None else key)
        return self.index[key]


def write_source(source: dict, groups: list[dict], subjects: list[str], items: list[list]) -> Path:
    """Grava <id>.json e atualiza o index.json com o resumo da fonte."""
    source = {**source, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    out = LIBRARY / f"{source['id']}.json"
    out.write_text(
        json.dumps({"schema": SCHEMA, "source": source, "groups": groups, "subjects": subjects, "items": items}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    index_path = LIBRARY / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"schema": SCHEMA, "sources": []}
    summary = {
        **{k: source[k] for k in ("id", "name", "publisher", "country", "description", "homepage", "license", "adapter", "updatedAt")},
        "items": len(items),
        "municipal": sum(1 for it in items if it[6] & MUNICIPAL),
        "bytes": out.stat().st_size,
    }
    index["sources"] = sorted([s for s in index["sources"] if s["id"] != source["id"]] + [summary], key=lambda s: s["name"])
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[library] {source['id']}: {len(items)} itens ({summary['municipal']} por município) -> {out.name} ({summary['bytes'] / 1e3:.0f} KB)")
    return out
