"""Baixa e prepara as camadas do catálogo (datapacks) em data/out/datapacks/.

Para cada datapack gera:
- <id>.geojson    os dados prontos para o mapa
- <id>.meta.json  quando foi atualizado e quantas feições tem

Uso: python datapacks/build.py [id ...]   (sem ids: todos)
Somente biblioteca padrão.
"""

from __future__ import annotations

import csv
import datetime as dt
import gzip
import io
import json
import math
import sys
import urllib.request
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT.parent / "data" / "out" / "datapacks"
USER_AGENT = "pinny-datapacks/0.1"

# Retângulo do Brasil (filtro grosso para fontes continentais).
BRAZIL_BBOX = (-74.0, -34.0, -34.5, 5.5)
EARTH_RADIUS_M = 6_378_137.0
GZIP_MAGIC = bytes([0x1F, 0x8B])


def log(msg: str) -> None:
    print(f"[datapacks] {msg}", flush=True)


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    # Algumas APIs (IBGE) respondem em gzip mesmo sem Accept-Encoding.
    return gzip.decompress(data) if data[:2] == GZIP_MAGIC else data


def ring_area_m2(ring: list[list[float]]) -> float:
    """Área de um anel lon/lat na esfera (mesma fórmula do Turf/d3-geo)."""
    n = len(ring)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        lon1, lat1 = ring[i - 1]
        lon2, lat2 = ring[i]
        total += math.radians(lon2 - lon1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total * EARTH_RADIUS_M**2 / 2)


def polygon_area_km2(geometry: dict) -> float:
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    m2 = 0.0
    for rings in polygons:
        m2 += ring_area_m2(rings[0]) - sum(ring_area_m2(r) for r in rings[1:])
    return m2 / 1e6


def municipios_populacao() -> dict:
    log("baixando malha municipal (IBGE)")
    malha = json.loads(
        http_get(
            "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
            "?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio"
        )
    )
    log("baixando população do Censo 2022 (IBGE)")
    agregado = json.loads(
        http_get(
            "https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6%5Ball%5D"
        )
    )
    populacao: dict[str, tuple[str, int]] = {}
    for serie in agregado[0]["resultados"][0]["series"]:
        local = serie["localidade"]
        valor = serie["serie"].get("2022", "")
        if valor.isdigit():
            populacao[local["id"]] = (local["nome"], int(valor))

    features = []
    for feature in malha["features"]:
        code = feature["properties"]["codarea"]
        if code not in populacao:
            continue
        label, pop = populacao[code]
        nome, _, uf = label.rpartition(" - ")
        area = polygon_area_km2(feature["geometry"])
        features.append(
            {
                "type": "Feature",
                "id": int(code),
                "geometry": feature["geometry"],
                "properties": {
                    "codigo": code,
                    "nome": nome,
                    "uf": uf,
                    "populacao": pop,
                    "area_km2": round(area, 1),
                    "densidade": round(pop / area, 2) if area > 0 else 0,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


UF_SIGLAS = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
    "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
    "50": "MS", "51": "MT", "52": "GO", "53": "DF",
}


def estados_populacao() -> dict:
    log("baixando malha estadual (IBGE)")
    malha = json.loads(
        http_get(
            "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
            "?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF"
        )
    )
    log("baixando população do Censo 2022 por UF (IBGE)")
    agregado = json.loads(
        http_get(
            "https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N3%5Ball%5D"
        )
    )
    populacao = {
        s["localidade"]["id"]: (s["localidade"]["nome"], int(s["serie"]["2022"]))
        for s in agregado[0]["resultados"][0]["series"]
        if s["serie"].get("2022", "").isdigit()
    }
    features = []
    for feature in malha["features"]:
        code = feature["properties"]["codarea"]
        if code not in populacao:
            continue
        nome, pop = populacao[code]
        area = polygon_area_km2(feature["geometry"])
        features.append(
            {
                "type": "Feature",
                "id": int(code),
                "geometry": feature["geometry"],
                "properties": {
                    "codigo": code,
                    "nome": nome,
                    "uf": UF_SIGLAS.get(code, ""),
                    "populacao": pop,
                    "area_km2": round(area, 1),
                    "densidade": round(pop / area, 2) if area > 0 else 0,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def queimadas_24h() -> dict:
    log("baixando focos de queimada das últimas 24 h (NASA FIRMS)")
    raw = http_get(
        "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_24h.csv"
    ).decode("utf-8")
    confianca = {"l": "baixa", "low": "baixa", "n": "nominal", "nominal": "nominal", "h": "alta", "high": "alta"}
    features = []
    w, s, e, n = BRAZIL_BBOX
    for row in csv.DictReader(io.StringIO(raw)):
        lat, lon = float(row["latitude"]), float(row["longitude"])
        if not (w <= lon <= e and s <= lat <= n):
            continue
        t = row["acq_time"].zfill(4)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                "properties": {
                    "datahora": f"{row['acq_date']} {t[:2]}:{t[2:]} UTC",
                    "frp": float(row["frp"] or 0),
                    "confianca": confianca.get(row["confidence"].lower(), row["confidence"]),
                    "periodo": "dia" if row["daynight"] == "D" else "noite",
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


BUILDERS: dict[str, Callable[[], dict]] = {
    "municipios-populacao": municipios_populacao,
    "estados-populacao": estados_populacao,
    "queimadas-24h": queimadas_24h,
}


def main() -> None:
    ids = sys.argv[1:] or list(BUILDERS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for pack_id in ids:
        if pack_id not in BUILDERS:
            raise SystemExit(f"datapack desconhecido: {pack_id}")
        collection = BUILDERS[pack_id]()
        data_path = OUT_DIR / f"{pack_id}.geojson"
        data_path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        meta = {
            "id": pack_id,
            "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "features": len(collection["features"]),
            "bytes": data_path.stat().st_size,
        }
        (OUT_DIR / f"{pack_id}.meta.json").write_text(json.dumps(meta), encoding="utf-8")
        log(f"{pack_id}: {meta['features']} feições, {meta['bytes'] / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
