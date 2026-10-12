"""Baixa as fontes (glyphs) e ícones (sprites) do mapa base para data/out/assets/.

Fonte: https://github.com/protomaps/basemaps-assets (o próprio README indica baixar o ZIP).
Licenças: fontes Noto Sans (SIL OFL), sprites derivados de tangrams/icons (MIT).

Uso: python data/fetch_assets.py [--force]
Sem isso, o servidor de desenvolvimento redireciona /data/assets para o GitHub Pages do Protomaps.
"""

from __future__ import annotations

import argparse
import io
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out" / "assets"
ZIP_URL = "https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.zip"
USER_AGENT = "city-view/0.1 (+https://github.com/yagpdc/city_view)"
KEEP = ("fonts/", "sprites/")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="baixa de novo mesmo se já existir")
    args = parser.parse_args()

    if (OUT / "sprites").exists() and not args.force:
        print(f"[assets] já existe: {OUT} (use --force para baixar de novo)")
        return

    print(f"[assets] baixando {ZIP_URL}")
    request = urllib.request.Request(ZIP_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as res:
        data = res.read()

    if OUT.exists():
        shutil.rmtree(OUT)
    files = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            # Entradas vêm como "basemaps-assets-main/fonts/…"
            _, _, rel = info.filename.partition("/")
            if info.is_dir() or not rel.startswith(KEEP):
                continue
            target = OUT / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))
            files += 1
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"[assets] {files} arquivos, {size / 1e6:.1f} MB em {OUT}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
