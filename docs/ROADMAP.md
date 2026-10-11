# City View — Roadmap (24+ meses)

> Documento vivo. Cada fase termina com algo **usável** rodando localmente.
> Estimativas assumem 1 dev + agentes; ajustar conforme a realidade.

## Princípios

1. **Não reinventar o motor cedo.** Começamos sobre MapLibre GL + deck.gl e escondemos isso atrás da nossa própria API (`@cityview/engine`). Motor próprio (WebGPU) só se/quando medirmos um gargalo real.
2. **Performance é feature.** Todo cálculo pesado roda fora da main thread (Web Workers) e, quando valer a pena, em Rust → WASM.
3. **Dados abertos e formatos abertos.** PMTiles, GeoJSON, GeoParquet, 3D Tiles, COG, MVT.
4. **Local-first.** Tudo roda na máquina, sem serviços pagos, sem chave de API.

---

## Fase 0 — Fundação (semanas 1–4)

- [ ] Monorepo (pnpm workspaces + Cargo workspace)
- [ ] App web (Vite + React + TS) com mapa base vetorial servido de um arquivo **PMTiles local**
- [ ] Terreno 3D (DEM) + prédios extrudados (2.5D)
- [ ] Camada `@cityview/engine` encapsulando MapLibre/deck.gl
- [ ] Lint, testes (Vitest / cargo test), CI local via scripts
- [ ] Script `data/` para baixar/gerar extrato da sua cidade/região

**Entrega:** abrir `localhost`, navegar em 3D numa cidade real, offline.

## Fase 1 — Desenho e medição (meses 2–6)

- [ ] Ferramentas de desenho: ponto, linha, polígono, círculo, retângulo, texto
- [ ] Edição de vértices, snapping, undo/redo (command pattern)
- [ ] Medição **geodésica**: distância, perímetro, área, azimute
- [ ] Perfil de elevação ao longo de uma linha (usando o DEM)
- [ ] Painel de camadas (ordem, visibilidade, opacidade, estilo)
- [ ] Import/export: GeoJSON, KML, GPX, CSV (lat/lon), Shapefile, GeoParquet
- [ ] Backend (Rust/axum) + PostGIS: salvar projetos, camadas e features

**Entrega:** um "Google My Maps" local, mais preciso e rápido.

## Fase 2 — Dados em escala (meses 6–12)

- [ ] Estilo orientado a dados (por atributo): choropleth, categorias, gradientes
- [ ] Heatmap, hexbin (H3), clusters, fluxos (arcos)
- [ ] Milhões de pontos (GeoArrow / binário direto para GPU)
- [ ] Slider temporal (dados com tempo)
- [ ] Consultas espaciais: buffer, interseção, contém, mais próximo
- [ ] DuckDB (spatial) para análise local + DuckDB-WASM no navegador
- [ ] `geo-core` em Rust → WASM para operações pesadas
- [ ] Geração de vector tiles a partir de dados do usuário (tippecanoe / martin)

**Entrega:** jogar um CSV de 5M de linhas e explorar em 60 fps.

## Fase 3 — 3D de verdade (meses 12–18)

- [ ] Globo (projeção globe) e transição suave para mapa
- [ ] 3D Tiles / fotogrametria / modelos glTF posicionados
- [ ] Nuvens de pontos (LAS/LAZ/COPC)
- [ ] Sol e sombras por data/hora
- [ ] Análises de terreno: declividade, aspecto, linha de visada, viewshed, volume de corte/aterro
- [ ] Medição 3D (altura, distância no espaço, área de fachada)

**Entrega:** gêmeo digital simples de um bairro.

## Fase 4 — Serviços e análise (meses 18–24)

- [ ] Geocodificação local (Photon/Nominatim) e busca
- [ ] Rotas e isócronas (Valhalla) sobre OSM
- [ ] Colaboração em tempo real (CRDT / Yjs)
- [ ] Notebooks/consultas SQL espaciais dentro do app
- [ ] SDK público (`@cityview/sdk`) para embutir mapas em outros sites
- [ ] Sistema de plugins (camadas, ferramentas, painéis de terceiros)

**Entrega:** plataforma que outras pessoas conseguem usar para construir em cima.

## Fase 5 — Além (24+ meses)

- [ ] Avaliar motor de render próprio em WebGPU (só com benchmarks justificando)
- [ ] Imagens de satélite / raster analytics (COG, índices como NDVI)
- [ ] Streaming de dados ao vivo (IoT, veículos)
- [ ] Infra/deploy, multiusuário, permissões
- [ ] Marketplace de plugins e datasets
