# City View

Plataforma web de mapas 2D/3D para visualizar, desenhar, medir e analisar dados geoespaciais. Roda localmente.

- Roadmap: `docs/ROADMAP.md`
- Arquitetura e stack: `docs/ARCHITECTURE.md`
- Decisões: `docs/adr/`

## Agentes

Especialistas em `.claude/agents/`. Delegue ao agente quando o assunto for dele:

| Assunto | Agente |
|---|---|
| Renderização, MapLibre, deck.gl, shaders, 3D, fps | `map-rendering` |
| Medição, geodésia, projeções, algoritmos geométricos, Rust/WASM | `geo-compute` |
| Tiles, OSM/Overture, DEM, formatos, importação/exportação | `geo-data` |
| API, PostGIS, DuckDB, persistência | `backend` |
| Interface, ferramentas de desenho, UX, painéis | `frontend-ui` |
| Medir/otimizar performance (bundle, memória, frame time) | `perf` |

## Layout padrão da interface

```
[opções] [ busca ................ ]   TopBar (apps/web/src/components/TopBar.tsx)
[sidebar] [         mapa          ]   Sidebar recolhível; o mapa estica quando fechada
```

- Barra superior: botão de opções/filtros à esquerda, busca ao lado.
- Opções, filtros e camadas ficam na Sidebar, organizados em `SidebarSection`. Nada de painel flutuando sobre o mapa.
- Em telas < 768px a Sidebar sobrepõe o mapa e começa fechada.
- Cores e medidas vêm dos tokens CSS em `apps/web/src/styles.css` (tema claro/escuro).

## Convenções

- Idioma: código e nomes em inglês; docs e conversa em português.
- Coordenadas sempre `[lon, lat]` (ordem GeoJSON), WGS84 (EPSG:4326) salvo indicação contrária.
- Distâncias/áreas: sempre geodésicas (elipsoide), nunca euclidianas em graus.
- Cálculo pesado nunca na main thread.
- Grandes binários de dados (`*.pmtiles`, `*.tif`, `*.osm.pbf`) não vão para o git.
- Mudança de stack/arquitetura → registrar ADR em `docs/adr/`.
