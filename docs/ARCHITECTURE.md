# Arquitetura e Stack

Decisão inicial (pode ser revista via ADR em `docs/adr/`).

## Visão geral

```
┌──────────────────────── Navegador ────────────────────────┐
│  apps/web (React + Vite + TS)                              │
│     │ UI: painéis, ferramentas, camadas                    │
│     ▼                                                      │
│  packages/engine  ── API própria do mapa                   │
│     ├─ MapLibre GL JS  (mapa base vetorial, terreno, globo)│
│     ├─ deck.gl         (camadas de dados, 3D, GPU)         │
│     └─ Workers ── packages/geo-wasm (Rust → WASM)          │
└───────────────┬────────────────────────────────────────────┘
                │ HTTP / WebSocket
┌───────────────▼──────────── Local ─────────────────────────┐
│  services/api (Rust + axum)                                │
│     ├─ PostgreSQL + PostGIS   (projetos, features)         │
│     ├─ DuckDB spatial         (análise / GeoParquet)       │
│     └─ crates/geo-core        (mesma lógica do WASM)       │
│  data/  PMTiles, DEM, extratos OSM/Overture                │
└────────────────────────────────────────────────────────────┘
```

## Por que cada peça

| Peça | Escolha | Motivo |
|---|---|---|
| Linguagem front | TypeScript | Ecossistema de mapas web é todo JS/TS |
| UI | React + Vite | Maior ecossistema; deck.gl tem integração oficial |
| Mapa base | MapLibre GL JS | Open source (BSD), vetorial, terreno, globo, estilo |
| Dados/3D | deck.gl | GPU, milhões de features, 3D Tiles, nuvem de pontos |
| Cálculo geo | Turf.js → Rust/WASM | Turf para começar; Rust para desempenho e precisão |
| Geodésia | `geographiclib` | Distância/área no elipsoide WGS84 (precisão mm) |
| Backend | Rust + axum | Rápido, compartilha código com o WASM |
| Banco | PostGIS | Padrão da indústria para dados espaciais |
| Analítico | DuckDB spatial | Lê GeoParquet/CSV gigantes sem ETL |
| Tiles | PMTiles | Arquivo único, sem servidor de tiles |

## Estrutura do repositório (alvo)

```
apps/web/            app principal
packages/engine/     API do mapa (wrapper MapLibre + deck.gl)
packages/ui/         componentes de interface
packages/geo-wasm/   bindings WASM de crates/geo-core
crates/geo-core/     geometria, medição, geodésia (Rust)
services/api/        backend HTTP (Rust/axum)
data/                scripts de download/geração de dados (gitignored os binários)
docs/                roadmap, arquitetura, ADRs
.claude/agents/      agentes especialistas
```

## Recursos gratuitos que vamos reaproveitar

- **Mapa base:** [Protomaps](https://protomaps.com) basemap em PMTiles (dados OSM, ODbL) + estilos e fontes deles
- **Dados vetoriais:** OpenStreetMap (Geofabrik extracts), [Overture Maps](https://overturemaps.org) (prédios com altura, lugares, endereços – GeoParquet)
- **Terreno:** tiles Terrarium/Terrain-RGB do AWS Open Data, Copernicus DEM GLO-30
- **Ferramentas de dados:** GDAL/ogr2ogr, tippecanoe, pmtiles CLI, martin, planetiler
- **Serviços self-hosted (fase 4):** Photon/Nominatim (geocodificação), Valhalla/OSRM (rotas)
- **Libs:** Turf.js, H3, loaders.gl, Yjs, geographiclib, crates `geo`/`geozero`/`h3o`

⚠️ Atenção a licenças: OSM exige atribuição (ODbL). Evitar tiles de Google/Esri/Mapbox (termos proíbem uso fora dos SDKs deles).
