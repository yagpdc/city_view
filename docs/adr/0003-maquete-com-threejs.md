# ADR 0003 — Maquete holográfica com three.js

- Data: 2026-10-12
- Estado: aceita

## Contexto

A "maquete" antiga era o próprio mapa (MapLibre) inclinado, com o entorno escurecido. Não encantava: o
recorte não parecia um objeto, os prédios coloridos sumiam ou piscavam, e não havia vistas técnicas. A ideia
é um modelo 3D isolado do lugar clicado, chamativo como um holograma, fiel ao que temos em 3D (prédios com
altura do OSM, ruas, água, verde) e com várias vistas do mesmo modelo (planta, fachadas).

## Decisão

Uma cena própria em **three.js** (`packages/engine/src/maquete/`), separada do mapa:

- `extract.ts` lê o raio direto do PMTiles do mapa base (prédios, ruas, água, verde) e os pontos dos datasets
  ligados; passa para metros locais (só para desenhar; medidas mostradas seguem geodésicas).
- `scene.ts` monta o disco (chão desenhado em canvas), prédios translúcidos com arestas acesas (um mesh
  só), feixes dos dados, varredura, marcador do ponto e as vistas ortográficas (planta, fachada sul e leste)
  no mesmo canvas, com scissor.
- `MaqueteView` (web) cobre a área do mapa; exporta PNG.

## Alternativas

- **Continuar no MapLibre** (camadas fill-extrusion, câmera): sem isolamento do objeto, sem vistas
  ortográficas simultâneas, sem materiais translúcidos/aditivos.
- **deck.gl**: bom para dados em mapa, mas o que queremos aqui é uma cena de objeto, não um mapa.

## Consequências

- +~600 KB de JS (three) — carregar sob demanda quando a maquete abrir é o próximo passo de performance.
- Cobertura = a do mapa base detalhado (hoje Grande SP). Fora dela, a maquete avisa.
- A maquete antiga (`DioramaPanel`, `CityMap.openDiorama`) fica sem uso e deve ser removida.
