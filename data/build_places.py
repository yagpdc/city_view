"""Lugares do Overture Maps (comércio, serviços, turismo…) para data/out/places/.

- places-<recorte>.parquet   recorte com colunas simples (nome, categoria, grupo, endereço…)
- places/<recorte>/          tiles.pmtiles + rows.idx (gerados pelo tiler em Rust)

Fonte: Overture Maps Foundation, tema "places" (GeoParquet no S3 público, release mensal).
Licenças: CDLA Permissive 2.0 (Meta, Microsoft e outros), Apache 2.0 (Foursquare), CC0 (AllThePlaces).
Atribuição obrigatória: https://docs.overturemaps.org/attribution/

Só lê os arquivos e grupos de linhas que cruzam o recorte (o DuckDB usa as estatísticas de bbox
de cada grupo), então o Brasil inteiro baixa ~1–2 GB em vez dos ~10 GB do mundo.

Uso: python data/build_places.py [--area brasil|sao-paulo] [--release 2026-09-23.1] [--force]
"""

from __future__ import annotations

import argparse
import io
import json
import platform
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
BIN_DIR = ROOT / "bin"
OUT_DIR = ROOT / "out"
USER_AGENT = "city-view/0.1 (+https://github.com/yagpdc/city_view)"
DUCKDB_VERSION = "1.5.6"
STAC = "https://stac.overturemaps.org"

AREAS: dict[str, tuple[float, float, float, float]] = {
    "brasil": (-74.0, -33.8, -34.7, 5.3),
    "sao-paulo": (-47.0, -24.1, -46.3, -23.3),  # Grande São Paulo
}

# Raiz da taxonomia do Overture → grupo legível (cor no mapa). São 10 grupos, o limite de cores
# do tiler; lugares sem categoria ficam sem grupo (cor neutra).
GROUPS: dict[str, str] = {
    "food_and_drink": "Alimentação",
    "shopping": "Compras",
    "services_and_business": "Serviços e empresas",
    "lifestyle_services": "Beleza e bem-estar",
    "health_care": "Saúde",
    "education": "Educação",
    "travel_and_transportation": "Viagem e hospedagem",
    "lodging": "Viagem e hospedagem",
    "cultural_and_historic": "Cultura e entretenimento",
    "arts_and_entertainment": "Cultura e entretenimento",
    "sports_and_recreation": "Esporte e lazer",
    "geographic_entities": "Esporte e lazer",
    "community_and_government": "Comunidade e governo",
}


def log(msg: str) -> None:
    print(f"[places] {msg}", flush=True)


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def duckdb_cli() -> Path:
    exe = BIN_DIR / ("duckdb.exe" if sys.platform == "win32" else "duckdb")
    if exe.exists():
        return exe
    system = {"win32": "windows", "darwin": "osx"}.get(sys.platform, "linux")
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "amd64"
    name = f"duckdb_cli-{system}-{'universal' if system == 'osx' else arch}.{'gz' if system == 'linux' else 'zip'}"
    url = f"https://github.com/duckdb/duckdb/releases/download/v{DUCKDB_VERSION}/{name}"
    log(f"baixando DuckDB {DUCKDB_VERSION}")
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    data = http_get(url)
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extract(exe.name, BIN_DIR)
    else:
        import gzip

        exe.write_bytes(gzip.decompress(data))
    exe.chmod(0o755)
    return exe


def latest_release() -> str:
    return json.loads(http_get(f"{STAC}/catalog.json"))["latest"]


def files_for(release: str, bbox: tuple[float, ...]) -> list[str]:
    """Arquivos do tema places cujo bbox (no catálogo STAC) cruza o recorte."""
    base = f"{STAC}/{release}/places/place"
    collection = json.loads(http_get(f"{base}/collection.json"))
    w, s, e, n = bbox
    files = []
    for link in collection["links"]:
        if link.get("rel") != "item":
            continue
        item = json.loads(http_get(link["href"] if link["href"].startswith("http") else f"{base}/{link['href']}"))
        x0, y0, x1, y1 = item["bbox"]
        if x0 <= e and x1 >= w and y0 <= n and y1 >= s:
            href = next(a["href"] for a in item["assets"].values() if a["href"].endswith(".parquet"))
            files.append(href)
    return files


def group_case() -> str:
    """CASE SQL: raiz da taxonomia → grupo em português."""
    whens = " ".join(f"WHEN '{root}' THEN '{label}'" for root, label in GROUPS.items())
    return f"CASE taxonomy.hierarchy[1] {whens} END"


def extract(release: str, area: str, out: Path) -> None:
    bbox = AREAS[area]
    files = files_for(release, bbox)
    if not files:
        raise SystemExit("nenhum arquivo do Overture cobre esse recorte")
    log(f"release {release}: {len(files)} arquivo(s) cobrem {area}")
    s3 = [f.replace("https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/", "s3://overturemaps-us-west-2/")
          .replace("https://overturemaps-us-west-2.s3.amazonaws.com/", "s3://overturemaps-us-west-2/") for f in files]
    w, s, e, n = bbox
    sql = f"""
INSTALL httpfs; LOAD httpfs;
SET s3_region = 'us-west-2';
SET enable_progress_bar = true;
COPY (
  WITH src AS (
    SELECT *
    FROM read_parquet({json.dumps(s3)})
    WHERE bbox.xmin <= {e} AND bbox.xmax >= {w} AND bbox.ymin <= {n} AND bbox.ymax >= {s}
      AND coalesce(operating_status, 'open') = 'open'
  )
  SELECT
    id,
    names.primary AS nome,
    {group_case()} AS grupo,
    coalesce(basic_category, taxonomy.primary) AS categoria,
    brand.names.primary AS marca,
    addresses[1].freeform AS endereco,
    addresses[1].locality AS cidade,
    addresses[1].region AS uf,
    addresses[1].postcode AS cep,
    websites[1] AS site,
    phones[1] AS telefone,
    emails[1] AS email,
    array_to_string(socials, ' ') AS redes,
    array_to_string(list_distinct(list_transform(sources, s -> s.dataset)), ', ') AS origem,
    substr(list_max(list_transform(sources, s -> s.update_time)), 1, 10) AS atualizado,
    round(confidence, 2) AS confianca,
    round((bbox.xmin + bbox.xmax) / 2, 6) AS lon,
    round((bbox.ymin + bbox.ymax) / 2, 6) AS lat
  FROM src
  WHERE names.primary IS NOT NULL
) TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd);
SELECT count(*) AS lugares, count(DISTINCT categoria) AS categorias FROM '{out.as_posix()}';
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".sql")
    tmp.write_text(sql, encoding="utf-8")
    log("lendo do S3 público só os grupos de linhas do recorte (pode levar alguns minutos)…")
    subprocess.run([str(duckdb_cli()), "-c", f".read {tmp.as_posix()}"], check=True)
    tmp.unlink()


SPEC = {
    "name": "Lugares (Overture Maps)",
    "lat": "lat",
    "lon": "lon",
    "latLocale": "intl",
    "lonLocale": "intl",
    "title": "nome",
    "colorBy": "grupo",
    "columns": [
        {"name": "nome", "type": "text"},
        {"name": "grupo", "type": "category"},
        {"name": "categoria", "type": "category"},
        {"name": "marca", "type": "text", "inTiles": True},
        {"name": "endereco", "type": "text", "inTiles": True},
        {"name": "cidade", "type": "category"},
        {"name": "uf", "type": "category"},
        {"name": "site", "type": "text", "inTiles": True},
        {"name": "telefone", "type": "text", "inTiles": True},
        {"name": "cep", "type": "text", "inTiles": True},
        {"name": "email", "type": "text", "inTiles": True},
        {"name": "redes", "type": "text", "inTiles": True},
        {"name": "origem", "type": "category"},
        {"name": "atualizado", "type": "text", "inTiles": True},
        {"name": "confianca", "type": "number", "locale": "intl"},
    ],
}


def region_specs() -> list[dict]:
    """Malhas do IBGE (catálogo, `pnpm datapacks`) para a vista "Regiões": contagem por estado e município."""
    levels = [("uf", "estados-populacao"), ("mun", "municipios-populacao")]
    paths = [(i, OUT_DIR / "datapacks" / f"{name}.geojson") for i, name in levels]
    return [{"id": i, "path": str(p), "code": "codigo"} for i, p in paths if p.exists()]


def tile(parquet: Path, area: str) -> None:
    out_dir = OUT_DIR / "places" / area
    spec = OUT_DIR / "places" / f"{area}.spec.json"
    regions = region_specs()
    # O recorte é um retângulo e pega países vizinhos: fica só o que cai num estado do Brasil.
    clip = {"clipTo": "uf"} if any(r["id"] == "uf" for r in regions) else {}
    spec.write_text(json.dumps({**SPEC, "regions": regions, **clip}, ensure_ascii=False, indent=2), encoding="utf-8")
    log("gerando tiles (tiler em Rust)…")
    subprocess.run(
        ["cargo", "run", "--release", "-q", "-p", "tiler", "--", str(parquet), str(out_dir), str(spec)],
        check=True,
        cwd=REPO,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--area", choices=sorted(AREAS), default="brasil")
    parser.add_argument("--release", help="versão do Overture (padrão: a mais recente)")
    parser.add_argument("--force", action="store_true", help="refaz mesmo se já existir")
    args = parser.parse_args()

    release = args.release or latest_release()
    parquet = OUT_DIR / "places" / f"places-{args.area}-{release}.parquet"
    if parquet.exists() and not args.force:
        log(f"recorte já existe ({parquet.name})")
    else:
        extract(release, args.area, parquet)
    tile(parquet, args.area)
    meta = {"release": release, "area": args.area, "bbox": AREAS[args.area], "parquet": parquet.name}
    (OUT_DIR / "places" / f"{args.area}.release.json").write_text(json.dumps(meta), encoding="utf-8")
    log(f"pronto: data/out/places/{args.area}/tiles.pmtiles (release {release})")


if __name__ == "__main__":
    main()
