# City View — Roadmap (24+ meses)

> Documento vivo. Cada fase termina com algo **usável** rodando localmente.
> Visão de produto e jornada do usuário: [PRODUCT.md](PRODUCT.md).

## Tese do produto

Uma **super interface para dados no mapa**: o usuário traz os **próprios dados** (ex.: milhões de registros — lojas, prédios, garagens, clientes, ativos), explora, filtra e **gera análises** sobre eles (densidade, contagem por região, cobertura, comparação, evolução no tempo).

Dois jeitos de usar, sobre o mesmo motor:
1. **Plataforma** — o espaço de trabalho onde o usuário sobe dados, analisa e monta mapas.
2. **SDK** — o mapa e as análises embutidos no produto do cliente com poucas linhas de código.

A gente cuida de todo o motor: ingestão, indexação, tiles, consultas analíticas, renderização e interação.

## Princípios

1. **Escala é o diferencial.** 30M+ de registros navegando a 60 fps numa GPU integrada.
2. **Nunca mandar dado bruto ao navegador.** Agregado em zoom baixo, pontos só da área visível em zoom alto, detalhes sob demanda.
3. **Não reinventar o render cedo.** MapLibre por baixo, escondido atrás da nossa API (`@cityview/engine` → `@cityview/sdk`).
4. **Motor de dados em Rust.** Ingestão e geração de tiles são o coração do produto.
5. **DX de integração.** O cliente precisa de 3 linhas para ter um mapa funcionando.
6. **Sem dados próprios, com caminhos para dados.** Não produzimos nem vendemos datasets. Oferecemos um **catálogo de fontes** (públicas/externas) que o usuário baixa e aplica no mapa dele; a partir daí o dado é do usuário. Dados sintéticos existem só para teste e benchmark.
7. **Local-first por enquanto.** Infra e multi-cliente entram depois, mas o desenho já considera.

---

## Fase 0 — Fundação ✅ (out/2026)

- [x] Monorepo pnpm, app web (Vite + React + TS), `@cityview/engine` sobre MapLibre
- [x] Mapa base vetorial e relevo de São Paulo em PMTiles locais; prédios 3D
- [x] Layout padrão (topbar + sidebar recolhível + mapa)
- [x] Glyphs e sprites servidos localmente (`pnpm assets`; sem eles, redireciona ao CDN do Protomaps)
- [ ] Lint/format

## Fase 1 — Prova de conceito: 30M de pontos embutidos (meses 1–2)

- [x] Gerador de dados sintéticos (`crates/synth`): 30M de empresas em 6,7 s
- [x] `crates/tiler` (Rust): Parquet → agregação H3 por zoom + pontos individuais no z14 → PMTiles
  - 30M → 463 MB em 40 s, pico de 1,8 GB de RAM, maior tile 124 KB (gzip); validado com `pmtiles verify`
- [x] `@cityview/sdk`: `CityView.map({ container, dataset })`, `filter()`, eventos `click`/`ready`/`idle`
- [x] `apps/embed-demo`: site de "empresa cliente" com filtros, clique e painel de métricas
- [x] Mapa base do Brasil até z12 (756 MB) para dar contexto aos dados
- [ ] Benchmark com janela visível (fps no tour de câmera) — medido até agora só com o navegador em segundo plano
- [ ] Filtros de porte/ano também nos agregados (hoje só nos pontos individuais; exige tiles dinâmicos — fase 2)

**Medido (navegador do app, em segundo plano):** primeiro mapa 1,37 s · filtro 58 ms · SDK 299 KB gzip (+ worker).
**Metas:** 60 fps navegando; primeiro mapa < 1,5 s; filtro < 200 ms; geração de 30M em minutos.

## Fase 2 — Primeiros encantos do produto (meses 2–6)

Ordem pensada por encanto/esforço (ver [PRODUCT.md](PRODUCT.md)).

**2a. Catálogo e pontos de partida**
- [x] Formato de datapack: manifesto (fonte, licença, atribuição, atualização, render, campos) + receita em `datapacks/build.py`
- [ ] 5–8 camadas brasileiras abertas — feitas: população por município e por estado (IBGE), queimadas 24 h (NASA FIRMS), lugares (Overture Maps, ~6,5 mi no Brasil)
  - próximas: rodovias federais (DNIT, 336 mil segmentos — exige tiler de linhas), escolas (INEP), saúde (CNES), CNPJs
- [x] Painel de catálogo na plataforma, com fonte/licença/atualização visíveis e aviso de desatualizado
- [x] Pontos de partida por objetivo (varejo, agro, risco, explorar)
- [x] Biblioteca de dados multi-fonte ([LIBRARY.md](LIBRARY.md)): índice comum + adaptador por fonte
  - IBGE SIDRA (9.336 tabelas, 4.448 por município) e Ipeadata (3.285 séries)
  - busca sem acento, sinônimos, anos, relevância; filtros por fonte, grupo e "por município"
  - "Baixar CSV" direto da fonte (Excel BR) e "Ver no mapa": valores por município cruzados com a malha IBGE, legenda por quantis
- [ ] Próximas fontes: INPE, DATASUS, INEP, ANATEL, ANP, TSE, Banco Central (SGS), dados.gov.br, MapBiomas; depois internacionais
- [x] Opções por item (período, recorte, variável) antes de baixar ou mapear; camadas da biblioteca salvas no navegador
- [x] Classificações do SIDRA (sexo, idade…) e mapas por estado além de município
- [x] Clique cruzando camadas: dado do cliente + todas as camadas do catálogo no mesmo ponto
- [ ] Atualização automática das camadas vivas (hoje: rodar `pnpm datapacks`)

**2b. Ingestão sem atrito**
- [x] Arrastar CSV/TSV no mapa → wizard (arquivo, localização, colunas, revisão) → camada em "Seus dados"
  - detecta separador, codificação (UTF-8/Latin-1), lat/lon, tipos e formato numérico brasileiro por coluna
  - relatório de linhas ignoradas com motivo e número da linha; cor por categoria; clique mostra os atributos
  - 500 mil linhas: leitura ~2–3 s, revisão 0,4 s, importação 3,5 s (tudo em Web Worker)
- [x] Servidor local (`services/api`, Rust/axum): arquivos de qualquer tamanho pelo motor Rust
  - wizard lê só uma amostra (5 mil linhas) de arquivos grandes; envio com progresso; fila com etapas
  - 3 milhões de linhas (139 MB): 9,6 s do envio ao mapa; clique traz todas as colunas da linha original
  - tiler genérico (colunas e categoria de cor quaisquer), mesmas regras numéricas do importador TS
- [x] GeoJSON e Excel (.xlsx) no wizard (Excel: 1ª planilha; GeoJSON: linhas/áreas viram o centro da extensão)
- [x] Parquet no wizard (navegador lê só os bytes necessários; grandes vão ao servidor; GeoParquet vira longitude/latitude)
- [x] Datasets importados salvos no navegador (IndexedDB): voltam ao recarregar; renomear, remover, enquadrar; camadas ligadas lembradas
  - 500 mil pontos (74 MB) salvos em ~3 s em segundo plano; leitura do banco em ms
- [ ] Migrar datasets do navegador para o servidor (IndexedDB vira cache)
- [ ] Geocodificação de endereços/CEP para quem não tem lat/lon (Photon/Nominatim local)
- [x] Tiler genérico: colunas numéricas/categóricas nos tiles, texto/datas pelo índice de linhas

**2c. Primeira análise e colaboração**
- [x] Cartão no mapa ao clicar + "por perto" (Lugares em 200 m/500 m/1 km, por grupo e os mais próximos, distância geodésica)
- [x] Anotações: traço livre, linha, área (livre, retângulo, círculo), texto e alfinete com nota; guardadas na aba, no link e em GeoJSON
- [x] "O que tem dentro" de áreas desenhadas (contagem por camada e categoria, densidade)
- [ ] Próximo nas anotações: alfinete com foto, imagem sobreposta pelos 4 cantos, pintar ruas e prédios, territórios, modo apresentação
- [x] Link compartilhável com câmera, camadas, camadas da biblioteca (refeitas na fonte) e aparência
- [ ] Link: filtros do dataset, seleção e maquete (visualização avançada)
- [ ] Widgets do viewport (contagem, categorias, histograma)
- [ ] Motor de consultas (DuckDB) e API de detalhes; tiles dinâmicos para filtros arbitrários nos agregados

## Fase 3 — SDK completo (meses 6–10)

- [ ] Estilos por atributo (cor, tamanho, ícone), legendas, tooltips customizáveis
- [ ] Visualizações: hexbin, heatmap, cluster, choropleth por município/estado/setor censitário
- [ ] Seleção por área (laço, raio, polígono) com contagem/estatística
- [ ] Bundles: npm (ESM), `<script>` (UMD/CDN), wrappers React/Vue
- [ ] Documentação, playground e exemplos; versionamento semântico; testes visuais

## Fase 4 — Plataforma (meses 10–16)

- [ ] Backend (Rust/axum) + PostgreSQL: contas, organizações, datasets, chaves de API
- [ ] Upload pelo painel, status de processamento, pré-visualização
- [ ] Multi-cliente: isolamento de dados, tiles protegidos (URLs assinadas), cotas
- [ ] Editor de estilo visual do mapa no painel
- [ ] Analytics de uso do mapa embutido

## Fase 5 — Recursos avançados (meses 16–24)

- [ ] Desenho e medição geodésica (distância, área, perfil de elevação) expostos no SDK
- [ ] Análises: buffer, raio de cobertura, vizinho mais próximo, densidade
- [ ] Rotas e isócronas (Valhalla), geocodificação reversa
- [ ] 3D: prédios, extrusão de dados (ex.: altura = faturamento), globo
- [ ] Linha do tempo única para todas as camadas com data; dados ao vivo (streaming)
- [ ] Histórias: sequência de visões com notas → apresentação, vídeo ou embed
- [ ] Análises em blocos (estilo Workflows): buffer, interseção, contagem por região
- [ ] Servidor MCP: o assistente de IA do usuário consulta dados e opera o mapa

## Fase 6 — Além (24+ meses)

- [ ] Infra de produção, CDN de tiles, deploy
- [ ] Catálogo aberto a terceiros: qualquer um publica conectores/receitas de dados (marketplace)
- [ ] Motor de render próprio em WebGPU (só com benchmarks justificando)
