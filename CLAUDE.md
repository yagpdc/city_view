# Pinny

> O app se chamava City View até 2026-10-15. Tudo foi renomeado para Pinny (pacotes `@pinny/*`, `PinnyMap`, `pinny-api`, tokens `--pn-*`, camadas `pn-*`, chaves `pinny.*` e bancos `pinny*` no navegador, migrados sozinhos de `cityview*` por `storage/migrateBrand.ts`; arquivos PMTiles antigos com metadados `cityview` continuam lidos). Ainda com o nome antigo, por serem externos: repositório `yagpdc/city_view` (e o endereço do GitHub Pages `/city_view/`), bucket R2 `cityview-dados`, pasta `D:\city_view` e a chave SSH `oracle_cityview`.

**Visualizador de dados no mapa** — dados públicos (APIs e bases abertas) e dados do próprio usuário, com o mesmo peso. Super interface para dados no mapa: empresas e pessoas trazem os próprios registros (lojas, prédios, garagens, clientes, ativos… às vezes milhões), localizam e entendem esses dados no mapa e geram análises sobre eles na plataforma, e pode embutir mapas/análises no produto dele via SDK. A gente cuida de ingestão, tiles, consultas, render e interação. Roda localmente por enquanto.

- Roadmap: `docs/ROADMAP.md`
- Biblioteca de dados (fontes públicas): `docs/LIBRARY.md`
- Arquitetura e stack: `docs/ARCHITECTURE.md`
- Design system (cores, tipografia, espaço, ícones, componentes): `docs/DESIGN.md`
- Importação de dados (builder, receita, casos difíceis): `docs/IMPORT.md`
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
[marca | Mapa 1 × | Mapa 2 × | +]                                  faixa do topo: marca + abas (components/MapTabs.tsx)
[gaveta ... mapa em tela cheia ......... [busca][Compartilhar]]
[(abre    widgets soltos (ex.: "Na tela")                       (●)]
[ à esq.)                                                       (●)]
 (●) = botões redondos à direita (Camadas · Adicionar · Detalhes · Widgets · Ajustes): lado oposto às gavetas
 botão direito no mapa: medir, visualização avançada, copiar coordenadas
```

- **Abas de mapa** (`MapTabs` + `mapTabs.ts`): como abas do navegador. Cada aba guarda camadas no projeto, filtros, câmera, prédios acesos, tema e estilo do mapa base; aba nova começa zerada (herda só a aparência). Botão direito: Duplicar, Renomear, Fechar, Fechar as outras. Motor, biblioteca e dados (públicos e importados) são os mesmos em todas. Link compartilhado abre numa aba nova, com o nome da aba (`n` no link). Salvas no localStorage (`pinny.map-tabs`).
- **Botões redondos** (`components/Shell.tsx` · `Rail`, flutuando à direita do mapa, lado oposto às gavetas): Camadas · Adicionar · Detalhes · Widgets · Ajustes. Um por vez (clicar de novo fecha); nome no tooltip.
- **Gaveta** (`Panel` + `PanelCard`): cartão flutuante sobre o mapa (não empurra o mapa), fundo cinza, conteúdo em cartões brancos, título 18/600. Camadas = um `LayerCard` por camada no projeto (olho = visível/escondida, ⋯ = ações, legenda dentro, que também filtra por categoria via `PinnyMap.setCategoryFilter`). "Adicionar" lista o que dá para pôr no mapa.
- **Anotações** (`apps/web/src/annotations/`, botão redondo "Anotar"): doca embaixo com a turma, cada personagem uma ferramenta (Bolha traço à mão/reto, Hexa área livre/retângulo/círculo, Quadra pinta ruas e prédios com um clique, Lume texto, Pinny alfinete com nota e foto) e o utilitário Imagem (sobrepõe planta/croqui/foto, encaixada pelos 4 cantos), cores dos personagens. Fotos e imagens ficam no IndexedDB deste navegador (`annotations/photos.ts`, não vão no link); ruas e prédios pintados são do app (`annotations/paint.ts`, camada `pn-annot-paint`), o resto do Terra Draw. Editor = Terra Draw (MIT); textos e rótulos numa camada do app acima de tudo. Área selecionada mostra tamanho e o que tem dentro de cada camada de pontos (`PinnyMap.areaSummary`: ponto a ponto nas pequenas, hexágonos nas grandes). Guardadas na aba (`MapTab.annotations`), vão no link (`a`), baixam em GeoJSON; viram o cartão "Anotações" na gaveta de Camadas.
- **Gaveta que abre outra** (ex.: editor de estilo, pela paleta do cartão da camada): a segunda abre **ao lado** da primeira, mesma altura; fechar ou trocar a primeira fecha a segunda. Sem espaço ao lado (< 1000px), cobre a primeira.
- **Widgets** (`FloatingWidget`): janelas pequenas soltas sobre o mapa (até 460×560), que arrastam (título), redimensionam (canto), minimizam e fecham; posição lembrada. Nunca rolam para o lado: o conteúdo se ajusta à largura e, se precisar, rola na vertical. A gaveta "Widgets" lista os disponíveis; um de cada tipo, o clicado vem para a frente; posição e ajustes em `pinny.widgets`. **Na tela** (`ViewportSummary`): números do que está visível (`PinnyMap.viewportSummary`). Em `components/MapWidgets.tsx`: **Gráfico por coluna** e **Tabela dos visíveis** (leem `PinnyMap.viewportRecords`: registros na tela com as colunas; afastado, pontos só com a cor contam à parte), **Raio ao redor** (centro escolhido no mapa, `PinnyMap.nearby`) e **Indicadores do lugar** (município no centro do mapa: IBGE + contagem por região das camadas). Mais: **Ranking de regiões** e **Oportunidade** (contagem por região do arquivo × população do IBGE ou camada da biblioteca: onde faltam/sobram registros), **Número em destaque** e **Nota**. Todos recalculam ao parar de mexer o mapa. Clicar numa barra do Gráfico (ou arrastar no histograma) muda o filtro do cartão da camada: mapa e outros widgets seguem. Os widgets são **da aba** (`MapTab.widgets`) e vão no link compartilhado (`w`).
- Sobre o mapa, só o que é do lugar: busca (`SearchBox`), cartão do clique (`MapPopup`), maquete 3D (`MaqueteView`, cores do mapa, cena three.js em `packages/engine/src/maquete`, cobre o mapa), visualizador de rua (`StreetViewer`), controles do mapa.
- Em telas < 768px a gaveta ocupa a largura e começa fechada.
- Cores e medidas vêm dos tokens `--pn-*` em `apps/web/src/tokens.css`, seguindo `docs/DESIGN.md`. Identidade (ADR 0005): arredondada, pastel, minimalista; uma cor só na plataforma, o lilás da marca (todas as gavetas e widgets em `.world-lilac`; as outras cores são só dos personagens), botão principal em tinta, títulos em Bricolage Grotesque, personagens-agente em `components/Agents.tsx` (rosto só em agentes, vazios e marca; nunca no mapa nem nos dados).

## Rodando local

- `pnpm dev`: tudo em http://localhost:5173 — plataforma, demo do SDK em `/demo/` e o servidor Rust (`/api`, iniciado automaticamente; `PINNY_NO_API=1` desliga)
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
