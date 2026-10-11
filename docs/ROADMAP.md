# City View — Roadmap (24+ meses)

> Documento vivo. Cada fase termina com algo **usável** rodando localmente.

## Tese do produto

Uma **super interface para dados no mapa**: o usuário traz os **próprios dados** (ex.: 30M de empresas), explora, filtra e **gera análises** sobre eles (densidade, contagem por região, cobertura, comparação, evolução no tempo).

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
- [ ] Glyphs e sprites servidos localmente (hoje vêm do CDN do Protomaps)
- [ ] Lint/format

## Fase 1 — Prova de conceito: 30M de pontos embutidos (meses 1–2)

- [ ] Gerador de dados sintéticos (30M de empresas no Brasil, distribuídas por população)
- [ ] `crates/tiler` (Rust): Parquet → agregação H3 por zoom + pontos individuais em zoom alto → PMTiles
- [ ] `@cityview/sdk`: `CityView.map({ container, dataset })`, filtros, eventos de clique
- [ ] Página de "empresa cliente" embutindo o mapa com 3 linhas
- [ ] Benchmarks: tempo de geração, tamanho, fps, tempo até primeiro mapa, latência de filtro

**Metas:** 60 fps navegando; primeiro mapa < 1,5 s; filtro < 200 ms; geração de 30M em minutos.

## Fase 2 — Dados reais e motor de análise (meses 2–6)

- [ ] Ingestão de CSV, Parquet, GeoJSON; mapeamento de colunas; validação e relatório de erros
- [ ] Geocodificação de endereços (CEP/logradouro) para quem não tem lat/lon
- [ ] Esquema do dataset: tipos de coluna, quais colunas viram filtro/estilo
- [ ] API de detalhes (clique → ficha completa pelo id) e de busca
- [ ] Filtros arbitrários: rápidos no cliente quando possível; tiles dinâmicos no servidor (DuckDB) com cache quando não
- [ ] Motor de consultas analíticas (DuckDB): agregações por região/polígono, estatísticas, comparações
- [ ] Primeiras análises na interface: contagem/densidade por área desenhada, por município e por raio
- [ ] Atualização incremental do dataset (sem regerar tudo)

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
- [ ] **Catálogo de dados (datapacks):** fontes curadas (IBGE, CNPJs da Receita, OSM, Overture…) com conector, licença e receita de importação; o usuário escolhe, baixa e aplica no próprio espaço de trabalho

## Fase 5 — Recursos avançados (meses 16–24)

- [ ] Desenho e medição geodésica (distância, área, perfil de elevação) expostos no SDK
- [ ] Análises: buffer, raio de cobertura, vizinho mais próximo, densidade
- [ ] Rotas e isócronas (Valhalla), geocodificação reversa
- [ ] 3D: prédios, extrusão de dados (ex.: altura = faturamento), globo
- [ ] Séries temporais (slider) e dados ao vivo (streaming)

## Fase 6 — Além (24+ meses)

- [ ] Infra de produção, CDN de tiles, deploy
- [ ] Catálogo aberto a terceiros: qualquer um publica conectores/receitas de dados (marketplace)
- [ ] Motor de render próprio em WebGPU (só com benchmarks justificando)
