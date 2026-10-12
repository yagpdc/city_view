# ADR 0003 — Maquete 3D com three.js

- Data: 2026-10-12
- Estado: aceita

## Contexto

A "maquete" antiga era o próprio mapa (MapLibre) inclinado, com o entorno escurecido. Não encantava: o
recorte não parecia um objeto, os prédios coloridos sumiam ou piscavam, e não havia vistas técnicas. A ideia
é um modelo 3D isolado do lugar clicado, chamativo, fiel ao que temos em 3D (prédios com
altura do OSM, ruas, água, verde) e com várias vistas do mesmo modelo (planta, fachadas).

## Decisão

Uma cena própria em **three.js** (`packages/engine/src/maquete/`), separada do mapa:

- `extract.ts` lê o raio direto do PMTiles do mapa base (prédios, ruas, água, verde) e os pontos dos datasets
  ligados; passa para metros locais (só para desenhar; medidas mostradas seguem geodésicas).
- `scene.ts` monta o disco (chão desenhado em canvas), prédios com arestas marcadas (um mesh só),
  alfinetes dos dados, marcador do ponto e as vistas ortográficas (planta, fachada sul e leste) no mesmo
  canvas, com scissor.
- **Cores do mapa, não um "modo" à parte**: `CityMap.maquetePalette()` dá as cores do mapa base no tema e
  estilo atuais (Protomaps + prédios 3D do mapa); fundo transparente, com o mapa esmaecido atrás.
  (Uma primeira versão "holograma", escura e brilhante, foi descartada: mudava demais o app.)
- `MaqueteView` (web) cobre a área do mapa; exporta PNG.

## Alternativas

- **Continuar no MapLibre** (camadas fill-extrusion, câmera): sem isolamento do objeto, sem vistas
  ortográficas simultâneas, sem materiais translúcidos/aditivos.
- **deck.gl**: bom para dados em mapa, mas o que queremos aqui é uma cena de objeto, não um mapa.

## Consequências

- three.js (~560 KB, ~145 KB gzip) fica num pedaço separado: `@cityview/engine/maquete` + `React.lazy`,
  baixado só quando a maquete abre.
- Cobertura = a do mapa base detalhado (hoje Grande SP). Fora dela, a maquete usa o mapa base (ruas e
  água) e avisa que não há prédios.
- A maquete antiga (mapa inclinado com máscara, `DioramaPanel`, `CityMap.enterDiorama`) foi removida.
  As comparações por município (`apps/web/src/compare.ts`) ficaram guardadas para voltar na maquete nova.
