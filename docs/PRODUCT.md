# Visão de produto

> O cliente sobe os dados dele e eles aparecem dentro de um Brasil já cheio de contexto.
> A análise nasce do cruzamento.

A City View centraliza o que vem de fora (dados do cliente, APIs, fontes públicas) e deixa fácil analisar tudo junto no mapa. O SDK leva essa mesma experiência para dentro do produto do cliente.

## A jornada que precisa encantar

1. **Abre** — escolhe um objetivo (*Expansão de varejo*, *Logística*, *Risco e segurança*, *Agro e clima*) e o mapa já abre com as camadas certas. Nunca um mapa vazio.
2. **Sobe os dados** — arrasta um CSV/planilha; colunas reconhecidas, endereços geocodificados, tudo no mapa em segundos.
3. **Cruza** — clica num ponto ou desenha uma área e recebe o resumo do entorno com todas as camadas.
4. **Compara** — filtros, widgets que acompanham o mapa e linha do tempo única.
5. **Compartilha** — link com o estado completo, apresentação (história) ou mapa embutido via SDK.

## Pilares

| Pilar | O que é | Inspiração |
|---|---|---|
| **Catálogo de dados (datapacks)** | Camadas prontas do Brasil com fonte, licença e data de atualização visíveis | Data Observatory (CARTO), feeds do God's Eye View |
| **Pontos de partida** | Objetivos que ligam um conjunto curado de camadas | Primeiro acesso do God's Eye View |
| **Ingestão sem atrito** | CSV/Parquet/GeoJSON, mapeamento de colunas, geocodificação, 30M+ linhas | — |
| **O que tem ao redor** | Clique/área → resumo cruzando todas as camadas | Painel de contatos (250 km) do God's Eye View |
| **Widgets do viewport** | Contagens, categorias, histogramas que recalculam ao mover/filtrar | Builder (CARTO) |
| **Linha do tempo única** | Um controle de tempo para todas as camadas com data | Linha do tempo de clima do God's Eye View |
| **Link compartilhável** | Câmera, camadas, filtros e seleção num link | Share links do God's Eye View |
| **Histórias** | Sequência de visões com notas → apresentação, vídeo ou embed | Scene director do God's Eye View |
| **Análises em blocos** | Buffer, interseção, contagem por região, sem código | Workflows (CARTO) |
| **Agentes de IA** | Servidor MCP: o assistente do próprio usuário consulta dados e opera o mapa | CARTO MCP Server / Agent Skills |
| **Chaves como upgrade** | Funciona sem chave; fontes pagas usam a conta do próprio cliente | "Power up" do God's Eye View |

## Confiança no dado

Toda camada mostra **fonte, licença, atribuição e última atualização**, e avisa quando está desatualizada. Uma plataforma de análise vive da confiança no dado.

## O que não fazemos

- Estética de espionagem/militar.
- Rastreamento de pessoas, leitura de placas ou qualquer dado pessoal identificável (LGPD). Movimentação só agregada e anônima.
- Efeitos visuais sem valor de decisão.
- Revender dados: o catálogo aponta para fontes; o dado importado passa a ser do usuário.

## Custo zero até a receita

- Fontes abertas com licença que permita uso comercial são nossas; fontes pagas, só com a chave do cliente.
- IA: via MCP, com o assistente que o usuário já usa (sem custo de inferência para nós).
- Tudo roda local até haver receita.
