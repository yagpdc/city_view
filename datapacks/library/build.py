"""Gera os índices da biblioteca de dados (ver docs/LIBRARY.md).

Uso: python datapacks/library/build.py [fonte ...]   (sem argumentos: todas)
Fontes: ibge-sidra, ipeadata
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "sources"))

import ibge_sidra  # noqa: E402
import ipeadata  # noqa: E402

BUILDERS = {"ibge-sidra": ibge_sidra.build, "ipeadata": ipeadata.build}


def main() -> None:
    names = sys.argv[1:] or list(BUILDERS)
    for name in names:
        if name not in BUILDERS:
            raise SystemExit(f"fonte desconhecida: {name} (disponíveis: {', '.join(BUILDERS)})")
        BUILDERS[name]()


if __name__ == "__main__":
    main()
