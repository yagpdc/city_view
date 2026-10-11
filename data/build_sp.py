"""Gera os dados locais de São Paulo em data/out/.

- sao-paulo.pmtiles          mapa base vetorial (Protomaps / OpenStreetMap)
- sao-paulo-terrain.pmtiles  relevo (Terrarium, AWS Open Data / Mapzen)

Uso: python data/build_sp.py [--force]
Somente biblioteca padrão. Idempotente: pula o que já existe.
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import math
import platform
import sqlite3
import subprocess
import sys
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BIN_DIR = ROOT / "bin"
CACHE_DIR = ROOT / "cache"
OUT_DIR = ROOT / "out"

# Região metropolitana de São Paulo (lon_min, lat_min, lon_max, lat_max)
BBOX = (-47.10, -24.05, -46.15, -23.35)
BASEMAP_MAXZOOM = 15
TERRAIN_MAXZOOM = 13

PMTILES_VERSION = "1.31.2"
PROTOMAPS_BUILD_URL = "https://build.protomaps.com/{date}.pmtiles"
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
USER_AGENT = "city_view-data/0.1"


def log(msg: str) -> None:
    print(f"[data] {msg}", flush=True)


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def http_ok(url: str) -> bool:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status == 200
    except Exception:
        return False


def pmtiles_cli() -> Path:
    exe = BIN_DIR / ("pmtiles.exe" if sys.platform == "win32" else "pmtiles")
    if exe.exists():
        return exe
    system = {"win32": "Windows", "darwin": "Darwin"}.get(sys.platform, "Linux")
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x86_64"
    ext = "zip" if system != "Linux" else "tar.gz"
    url = (
        f"https://github.com/protomaps/go-pmtiles/releases/download/v{PMTILES_VERSION}/"
        f"go-pmtiles_{PMTILES_VERSION}_{system}_{arch}.{ext}"
    )
    log(f"baixando pmtiles CLI {PMTILES_VERSION}")
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    data = http_get(url)
    if ext == "zip":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extract(exe.name, BIN_DIR)
    else:
        import tarfile

        with tarfile.open(fileobj=io.BytesIO(data)) as tf:
            tf.extract(exe.name, BIN_DIR)
        exe.chmod(0o755)
    return exe


def latest_protomaps_build() -> str:
    today = dt.date.today()
    for days in range(0, 10):
        url = PROTOMAPS_BUILD_URL.format(date=(today - dt.timedelta(days=days)).strftime("%Y%m%d"))
        if http_ok(url):
            return url
    raise RuntimeError("nenhum build recente do Protomaps encontrado")


def build_basemap(force: bool) -> None:
    out = OUT_DIR / "sao-paulo.pmtiles"
    if out.exists() and not force:
        log(f"mapa base já existe ({out.name})")
        return
    src = latest_protomaps_build()
    log(f"extraindo mapa base de {src}")
    bbox = ",".join(str(v) for v in BBOX)
    subprocess.run(
        [str(pmtiles_cli()), "extract", src, str(out), f"--bbox={bbox}", f"--maxzoom={BASEMAP_MAXZOOM}"],
        check=True,
    )


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return min(x, n - 1), min(y, n - 1)


def terrain_tiles() -> list[tuple[int, int, int]]:
    tiles = []
    for z in range(0, TERRAIN_MAXZOOM + 1):
        x0, y0 = lonlat_to_tile(BBOX[0], BBOX[3], z)
        x1, y1 = lonlat_to_tile(BBOX[2], BBOX[1], z)
        tiles += [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    return tiles


def fetch_terrain_tile(tile: tuple[int, int, int]) -> tuple[tuple[int, int, int], bytes]:
    z, x, y = tile
    cached = CACHE_DIR / "terrarium" / str(z) / str(x) / f"{y}.png"
    if not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(http_get(TERRARIUM_URL.format(z=z, x=x, y=y)))
    return tile, cached.read_bytes()


def build_terrain(force: bool) -> None:
    out = OUT_DIR / "sao-paulo-terrain.pmtiles"
    if out.exists() and not force:
        log(f"relevo já existe ({out.name})")
        return
    tiles = terrain_tiles()
    log(f"baixando {len(tiles)} tiles de relevo (z0-{TERRAIN_MAXZOOM})")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    mbtiles = CACHE_DIR / "terrain.mbtiles"
    mbtiles.unlink(missing_ok=True)
    db = sqlite3.connect(mbtiles)
    db.executescript(
        """
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
        CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
        """
    )
    meta = {
        "name": "sao-paulo-terrain",
        "format": "png",
        "type": "baselayer",
        "minzoom": "0",
        "maxzoom": str(TERRAIN_MAXZOOM),
        "bounds": ",".join(str(v) for v in BBOX),
        "attribution": "Terrain: Mapzen, AWS Open Data (SRTM, GMTED, ETOPO1 e outros)",
        "encoding": "terrarium",
    }
    db.executemany("INSERT INTO metadata VALUES (?, ?)", meta.items())

    with ThreadPoolExecutor(max_workers=16) as pool:
        for (z, x, y), data in pool.map(fetch_terrain_tile, tiles):
            tms_y = (2**z - 1) - y  # MBTiles usa esquema TMS
            db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (z, x, tms_y, data))
    db.commit()
    db.close()

    log("convertendo relevo para PMTiles")
    subprocess.run([str(pmtiles_cli()), "convert", str(mbtiles), str(out)], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="regera mesmo se já existir")
    args = parser.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_basemap(args.force)
    build_terrain(args.force)
    log(f"pronto: {OUT_DIR}")


if __name__ == "__main__":
    main()
