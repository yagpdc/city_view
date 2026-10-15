# Arquitetura e Stack

Decisões podem ser revistas via ADR em `docs/adr/`.

## Visão geral

```
 Empresa cliente                         Pinny
 ───────────────                         ─────────────────────────────────────────────
 dados (CSV/Parquet) ──upload/API──▶  crates/tiler (Rust)
                                        ├─ lê e valida (Parquet/CSV)
                                        ├─ projeta, indexa (H3), agrega por zoom
                                        └─ gera vector tiles → PMTiles
                                               │
 produto do cliente                            ▼
   @cityview/sdk  ◀──── tiles (HTTP Range) ── armazenamento de tiles
     └─ @cityview/engine (MapLibre)    ◀──── API de detalhes/filtros (fase 2+)
```

## Como 30M de pontos chegam a 60 fps

| Zoom | O que vai no tile | Por quê |
|---|---|---|
| 0–13 | Hexágonos H3 com contagem total e por categoria | Poucos milhares de features por tela, independente do volume |
| 14+ | Pontos individuais (id + poucos atributos) | Só a área visível; tiles mais profundos fazem overzoom |
| clique | Ficha completa via API pelo id | Atributos pesados nunca trafegam nos tiles |

- **Filtros por categoria** funcionam também nos agregados: cada hexágono guarda contagem por categoria, e o estilo soma só as selecionadas.
- **Filtros arbitrários** (combinações, faixas numéricas) em zoom baixo exigem tiles dinâmicos no servidor (fase 2).
- A escala de cor dos hexágonos usa densidade (contagem normalizada pela área da célula), com quebras calculadas pelo tiler e gravadas nos metadados do PMTiles.

## Pacotes

| Caminho | Papel |
|---|---|
| `crates/tiler` | Motor de dados: CSV/Parquet + mapeamento (spec) → H3 + pontos → PMTiles e índice de linhas. Escritores de MVT e PMTiles próprios |
| `services/api` | Servidor local (axum): upload em streaming, fila de processamento, tiles com Range, detalhes da linha pelo índice |
| `crates/synth` | Gerador de datasets sintéticos para testes e benchmarks |
| `packages/engine` | Fachada interna sobre MapLibre (mapa base, relevo, câmera) |
| `packages/sdk` | API pública que o cliente instala (`CityView.map`, filtros, eventos) |
| `apps/web` | Plataforma / painel (por enquanto, visualizador) |
| `apps/embed-demo` | Simula o site de uma empresa cliente usando o SDK |
| `datapacks/` | Catálogo: um manifesto por camada (fonte, licença, render, campos) + `build.py` que baixa e prepara |
| `data/` | Scripts de dados de referência (mapa base, relevo) |

## Stack

| Peça | Escolha | Motivo |
|---|---|---|
| Motor de dados | Rust (rayon, h3o, parquet) | Desempenho, paralelismo, memória previsível |
| Formato de tiles | MVT em PMTiles | Padrão aberto, arquivo único, servível por qualquer CDN |
| Render | MapLibre GL JS | Open source, vetorial, rápido, 3D |
| SDK/UI | TypeScript; React só na plataforma | O SDK não pode impor framework ao cliente |
| Backend (fase 2+) | Rust + axum, PostgreSQL/PostGIS, DuckDB | API, contas, consultas analíticas |

## Recursos gratuitos que reaproveitamos

A Pinny não produz nem vende dados. Usamos dados abertos como **referência visual** (mapa base, relevo) e mantemos um **catálogo de fontes** (datapacks) que o usuário pode baixar e aplicar no próprio mapa — ex.: IBGE (malhas, censo), Receita Federal (CNPJs), OSM, Overture. Cada item do catálogo traz conector, licença e receita de importação; o dado importado passa a ser do usuário.

- **Mapa base:** Protomaps (OSM, ODbL) em PMTiles + estilos/fontes
- **Relevo:** Terrarium (AWS Open Data), Copernicus DEM
- **Ferramentas:** GDAL, pmtiles CLI, DuckDB, H3
- **Serviços self-hosted futuros:** Photon/Nominatim, Valhalla

⚠️ OSM exige atribuição (ODbL). Não usar tiles de Google/Esri/Mapbox fora dos termos deles.
