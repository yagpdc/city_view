"""Gera data/out/cidades.pmtiles: mapa base detalhado (z15, com prédios 3D) das cidades em
data/specs/cidades.json — usado pelos prédios 3D do mapa e pela maquete.

Uso: python data/build_cidades.py [--force]
Extrai do build diário público do Protomaps (OpenStreetMap, ODbL) só os tiles das áreas listadas.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from build_sp import OUT_DIR, latest_protomaps_build, log, pmtiles_cli

SPEC = Path(__file__).resolve().parent / "specs" / "cidades.json"
MAXZOOM = 15


def region() -> dict:
    """MultiPolygon com um retângulo por área (pmtiles extract --region)."""
    polys = []
    for area in json.loads(SPEC.read_text(encoding="utf-8"))["areas"]:
        if "bbox" in area:
            w, s, e, n = area["bbox"]
        else:
            (lon, lat), h = area["center"], area["half"]
            w, s, e, n = lon - h, lat - h, lon + h, lat + h
        polys.append([[[w, s], [e, s], [e, n], [w, n], [w, s]]])
    return {"type": "Feature", "properties": {}, "geometry": {"type": "MultiPolygon", "coordinates": polys}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="regera mesmo se já existir")
    args = parser.parse_args()
    out = OUT_DIR / "cidades.pmtiles"
    if out.exists() and not args.force:
        log(f"já existe ({out.name}); use --force para regerar")
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    src = latest_protomaps_build()
    with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False, encoding="utf-8") as f:
        json.dump(region(), f)
        region_file = f.name
    log(f"extraindo {out.name} ({len(region()['geometry']['coordinates'])} áreas) de {src}")
    subprocess.run([str(pmtiles_cli()), "extract", src, str(out), f"--region={region_file}", f"--maxzoom={MAXZOOM}"], check=True)
    Path(region_file).unlink(missing_ok=True)
    log(f"pronto: {out} ({out.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
