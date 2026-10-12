# City View

**Visualizador de dados no mapa** — dados públicos (APIs e bases abertas) e dados do próprio usuário, com o mesmo peso. Super interface para dados no mapa: empresas e pessoas trazem os próprios registros (lojas, prédios, garagens, clientes, ativos… às vezes milhões), localizam e entendem esses dados no mapa e geram análises sobre eles na plataforma, e pode embutir mapas/análises no produto dele via SDK. A gente cuida de ingestão, tiles, consultas, render e interação. Roda localmente por enquanto.

- Roadmap: `docs/ROADMAP.md`
- Biblioteca de dados (fontes públicas): `docs/LIBRARY.md`
- Arquitetura e stack: `docs/ARCHITECTURE.md`
- Design system (cores, tipografia, espaço, ícones, componentes): `docs/DESIGN.md`
- Pôr no ar (VM, Caddy, scripts em `deploy/`): `docs/DEPLOY.md`
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
[marca .................... 2D/3D  Medir  Na tela  Compartilhar]   TopBar (components/TopBar.tsx)
[trilho][painel][          mapa + busca flutuante          ][Na tela]
```

- **Trilho** (`components/Shell.tsx` · `Rail`): Camadas · Adicionar · Detalhes · Ajustes. Um painel por vez (clicar de novo fecha).
- **Painel** (`Panel` + `PanelCard`): fundo cinza, conteúdo em cartões brancos, título 18/600. Camadas = um `LayerCard` por camada no projeto (olho = visível/escondida, ⋯ = ações, legenda dentro, que também filtra por categoria via `CityMap.setCategoryFilter`). "Adicionar" lista o que dá para pôr no mapa.
- **Na tela** (`WidgetsPanel`, à direita): números do que está visível, recalculados ao parar de mexer o mapa (`CityMap.viewportSummary`).
- Sobre o mapa, só o que é do lugar: busca (`SearchBox`), cartão do clique (`MapPopup`), maquete 3D (`MaqueteView`, cores do mapa, cena three.js em `packages/engine/src/maquete`, cobre o mapa), visualizador de rua (`StreetViewer`), controles do mapa.
- Em telas < 768px o painel sobrepõe o mapa e começa fechado; "Na tela" vira gaveta abaixo de 1100px.
- Cores e medidas vêm dos tokens `--cv-*` em `apps/web/src/tokens.css`, seguindo `docs/DESIGN.md`.

## Rodando local

- `pnpm dev`: tudo em http://localhost:5173 — plataforma, demo do SDK em `/demo/` e o servidor Rust (`/api`, iniciado automaticamente; `CITYVIEW_NO_API=1` desliga)
- Avulsos, se precisar: `pnpm api` (só o servidor, :8787) · `pnpm demo` (só a demo, :5174)
- **Windows:** rode `cargo` pelo PowerShell. No Git Bash, `/usr/bin/link.exe` esconde o linker da Microsoft.
- **Só o disco D:** nada de temporários, caches ou ferramentas no C: (está cheio e o usuário pediu). Rascunhos em `target/scratch`; em comandos, `TMP`/`TEMP` em `D:\city_view\target\tmp`; Rust (`~\.cargo`, `~\.rustup`) já mora em `D:\dev` (junções no lugar antigo); pnpm store em `D:\.pnpm-store`; ferramentas em `target/tools`.
- `pnpm places [-- --area sao-paulo]` gera a camada "Lugares" (Overture Maps: comércio, serviços, turismo…; Brasil ~6,5 mi de pontos, release mensal) em `data/out/places/`.
- `pnpm cidades` gera `data/out/cidades.pmtiles`: mapa detalhado (prédios 3D, z15) das capitais e grandes cidades em `data/specs/cidades.json` (prédios do mapa e maquete).
- `pnpm wasm` recompila o motor de tiles para o navegador (`crates/tiler-wasm` → `packages/tiler-wasm/pkg`, versionado). Precisa de `rustup target add wasm32-unknown-unknown` e `wasm-bindgen-cli` 0.2.95.
- `pnpm assets` baixa fontes e ícones do mapa para `data/out/assets` (mapa sem internet; sem isso o dev server redireciona ao Protomaps).
- Dados gerados ficam em `data/out/` e `data/workspace/` (fora do git).

## Convenções

- Idioma: código e nomes em inglês; docs e conversa em português.
- Coordenadas sempre `[lon, lat]` (ordem GeoJSON), WGS84 (EPSG:4326) salvo indicação contrária.
- Distâncias/áreas: sempre geodésicas (elipsoide), nunca euclidianas em graus.
- Cálculo pesado nunca na main thread.
- Grandes binários de dados (`*.pmtiles`, `*.tif`, `*.osm.pbf`) não vão para o git.
- Mudança de stack/arquitetura → registrar ADR em `docs/adr/`.
