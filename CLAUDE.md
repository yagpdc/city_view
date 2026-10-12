# City View

Super interface para dados no mapa: empresas e pessoas trazem os próprios registros (lojas, prédios, garagens, clientes, ativos… às vezes milhões), localizam e entendem esses dados no mapa e geram análises sobre eles na plataforma, e pode embutir mapas/análises no produto dele via SDK. A gente cuida de ingestão, tiles, consultas, render e interação. Roda localmente por enquanto.

- Roadmap: `docs/ROADMAP.md`
- Biblioteca de dados (fontes públicas): `docs/LIBRARY.md`
- Arquitetura e stack: `docs/ARCHITECTURE.md`
- Decisões: `docs/adr/`

## Agentes

Especialistas em `.claude/agents/`. Delegue ao agente quando o assunto for dele:

| Assunto | Agente |
|---|---|
| Ingestão de datasets, agregação H3, MVT/PMTiles, pipeline Rust | `tiling` |
| API pública do SDK, filtros, eventos, bundles, DX de integração | `sdk` |
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

## Rodando local

- `pnpm dev`: tudo em http://localhost:5173 — plataforma, demo do SDK em `/demo/` e o servidor Rust (`/api`, iniciado automaticamente; `CITYVIEW_NO_API=1` desliga)
- Avulsos, se precisar: `pnpm api` (só o servidor, :8787) · `pnpm demo` (só a demo, :5174)
- **Windows:** rode `cargo` pelo PowerShell. No Git Bash, `/usr/bin/link.exe` esconde o linker da Microsoft.
- `pnpm places [-- --area sao-paulo]` gera a camada "Lugares" (Overture Maps: comércio, serviços, turismo…; Brasil ~6,5 mi de pontos, release mensal) em `data/out/places/`.
- `pnpm assets` baixa fontes e ícones do mapa para `data/out/assets` (mapa sem internet; sem isso o dev server redireciona ao Protomaps).
- Dados gerados ficam em `data/out/` e `data/workspace/` (fora do git).

## Convenções

- Idioma: código e nomes em inglês; docs e conversa em português.
- Coordenadas sempre `[lon, lat]` (ordem GeoJSON), WGS84 (EPSG:4326) salvo indicação contrária.
- Distâncias/áreas: sempre geodésicas (elipsoide), nunca euclidianas em graus.
- Cálculo pesado nunca na main thread.
- Grandes binários de dados (`*.pmtiles`, `*.tif`, `*.osm.pbf`) não vão para o git.
- Mudança de stack/arquitetura → registrar ADR em `docs/adr/`.
