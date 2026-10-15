# Design system — Pinny

Biblioteca visual completa (pranchetas, estados, claro/escuro): https://claude.ai/artifact/NdEzL6qSo6r4uS2jUewFPH

## Identidade (2026-10-15, ADR 0005)

Prancha aprovada: https://claude.ai/artifact/TmPnN6hJEeiYaaFp4MdFCN. **Arredondada, pastel, minimalista** — e sério nos dados.

- **Base:** chão `#F6F5F1`, superfície `#FFFFFF`, borda `#E9E6DF`, texto suave `#6B6A72`, tinta `#1D1E24` (texto e botão principal, em pílula). Destaque `--cv-accent` lilás `#8B7CF6`.
- **Uma cor só na plataforma: o lilás da marca** — fundo `#E9E4FF`, personagem/destaque `#B9AEFF` e `#8B7CF6`, tinta `#4B3FB5`. Todas as gavetas, widgets e botões ativos usam esse mundo (`.world-lilac`, `--world-bg/fill/ink`). Selo "Público" neutro, "Seu dado" lilás. Estados (sucesso/atenção/erro) só em mensagens.
- **Cores dos personagens** (não pintam a interface):

| Personagem | Corpo | Fundo quando precisa |
|---|---|---|
| Pinny (lilás) | `#B9AEFF` | `#E9E4FF` |
| Hexa (menta) | `#9BE0BE` | `#DDF4E8` |
| Bolha (pêssego) | `#FFC09A` | `#FFE7D6` |
| Quadra (céu) | `#A8D1FF` | `#DDEEFF` |
| Lume (limão) | `#FFE07A` | `#FFF4C7` |

- **Nunca no mapa:** a cor do mapa é dos dados (paleta de categorias abaixo).
- **Personagens** (`components/Agents.tsx`, `AgentFace`): Pinny (alfinete, explorador), Hexa (hexágono, analista), Bolha (arrumadeira), Quadra (cartógrafa), Lume (vigia); humores neutro, pensando, feliz, alerta. Rosto só em agentes, vazios, carregamentos e na marca.
- **Personagens como ferramentas:** na doca de anotações cada personagem opera uma ferramenta (Bolha traço, Hexa área que calcula, Quadra pinta ruas e prédios, Lume texto, Pinny alfinete com foto; Selecionar e Imagem são utilitários sem personagem); o ativo fica feliz, sobe um pouco e "fala" a dica num balão lilás. O que ele desenha sai na cor dele (dá para trocar).
- **Tipografia:** títulos em Bricolage Grotesque 700 (`--cv-font-display`), interface Figtree, números DM Mono.
- **Forma:** cantos 6/10/14/20/26 e pílula; nada quadrado. Gaveta = fundo do mundo + cartões brancos. Widget = moldura no mundo + miolo branco.
- **Movimento:** abrir gaveta e widget com quique leve (`--cv-spring`, 260–280 ms); nada com `prefers-reduced-motion`.

As tabelas abaixo são da versão anterior (índigo, DM Sans) e valem para o que não foi listado aqui; os valores atuais estão em `apps/web/src/tokens.css`.

Regras gerais:

- Componente nunca usa hex solto: sempre um token `--cv-*`. O tema escuro troca só os valores.
- Cores de estado (sucesso/atenção/erro) nunca pintam dados no mapa.
- Sombra só no que flutua sobre o mapa; dentro de painéis, borda.

## Cores

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--cv-action` | `#4A50D6` | `#7F86F7` | botão principal, seleção |
| `--cv-action-hover` | `#3C3FB0` | `#A3A9FD` | |
| `--cv-on-action` | `#FFFFFF` | `#0B0F17` | texto sobre ação |
| `--cv-action-subtle` | `#EEF0FF` | `#1C1F45` | chip de filtro, controle ligado |
| `--cv-link` | `#3C3FB0` | `#A3A9FD` | |
| `--cv-focus` | `#7F86F7` | `#A3A9FD` | anel de foco (só teclado) |
| `--cv-selected` | `#6068EE` | `#7F86F7` | ponto selecionado no mapa |
| `--cv-bg` | `#FFFFFF` | `#0B0F17` | página, barra lateral |
| `--cv-surface` | `#F5F6F8` | `#151A24` | cartões, áreas |
| `--cv-float` | `#FFFFFF` | `#1B2130` | o que flutua sobre o mapa |
| `--cv-field` | `#FBFBFC` | `#10141C` | campos |
| `--cv-border` | `#DDE1E7` | `#2A3240` | |
| `--cv-border-strong` | `#C4CBD5` | `#3A4352` | botão secundário, hover de campo |
| `--cv-text` | `#151A24` | `#ECEEF2` | |
| `--cv-text-muted` | `#5F6878` | `#9AA3B2` | passa 4,5:1 no fundo e na superfície |
| `--cv-success` / `-bg` | `#15803D` / `#ECFDF3` | `#4ADE80` / `#0F2418` | |
| `--cv-warning` / `-bg` | `#B45309` / `#FFFBEB` | `#FBBF24` / `#2A1F08` | |
| `--cv-danger` / `-bg` | `#B91C1C` / `#FEF2F2` | `#F87171` / `#2B1010` | |
| `--cv-info` / `-bg` | `#1D4ED8` / `#EFF4FF` | `#7AA2FF` / `#0F1A33` | |

Mapa base: chão `#F5F6F8`/`#10141C`, água `#D6E4F0`/`#16243A`, parque `#E2EEE2`/`#14231B`, rua `#FFFFFF`/`#262E3B`, prédio `#E3E6EB`/`#1B212D`, rótulo `#5F6878`/`#9AA3B2`, anel dos pontos = cor do chão.

Dados (iguais nos dois temas; todas ≥ 3:1 nos mapas claro e escuro):

- Categorias `--cv-data-1…10`: `#2F6FD6` `#E8590C` `#2B9348` `#C2255C` `#1098AD` `#7048E8` `#B08900` `#8C6D31` `#5C940D` `#A61E4D`; outros `--cv-data-other` `#6B7485`.
- Densidade `--cv-density-1…7`: `#FFF3BF` `#FFD43B` `#FD7E14` `#E8590C` `#D6336C` `#AE3EC9` `#5F3DC4`.
- Divergente `--cv-diverging-n3…p3`: `#B35806` `#F1A340` `#FEE0B6` `#ECEEF2` `#C6DBEF` `#6BAED6` `#2166AC`.

## Tipografia

DM Sans (interface) + DM Mono (números, coordenadas, contagens; algarismos tabulares). Pesos 400–700. Mínimo 12 px (rótulo de mapa 11,5 px com halo).

| Token | Tamanho / linha / peso |
|---|---|
| `--cv-text-display` | 36 / 40 / 700, −0,02em |
| `--cv-text-title` | 24 / 30 / 700, −0,01em |
| `--cv-text-subtitle` | 18 / 24 / 600 |
| `--cv-text-body` | 15 / 22 / 400 |
| `--cv-text-body-strong` | 15 / 22 / 600 |
| `--cv-text-label` | 13 / 18 / 600 |
| `--cv-text-caption` | 12 / 16 / 400 |
| `--cv-text-overline` | 12 / 16 / 600, +0,08em, caixa alta |
| `--cv-text-map-label` | 11,5 / 14 / 500 + halo |
| `--cv-text-number` | Mono 14 / 20 |
| `--cv-text-number-sm` | Mono 12 / 16 |

Números no formato brasileiro: `1.948`, `12,4 km²`.

## Espaço e forma

- Espaçamento `--cv-space-{1,2,3,4,5,6,8,10,12,16}` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px.
- Cantos: `xs` 4 (checkbox) · `sm` 6 (dica, etiqueta) · `md` 10 (botão, campo) · `lg` 12 (cartão, menu) · `xl` 16 (o que flutua sobre o mapa) · `full` (chip, botão redondo).
- Sombras: `0` nenhuma · `1` `0 1px 2px rgba(21,26,36,.06)` + borda · `2` `0 4px 12px rgba(21,26,36,.10)` (menus, controles do mapa) · `3` `0 12px 32px rgba(21,26,36,.18)` (cartão do lugar) · `4` `0 24px 64px rgba(21,26,36,.28)` (diálogos). No escuro: superfície `--cv-float` + borda.
- Alvo de toque 44 px (compacto 36). Foco: anel 2 px `--cv-focus`, afastado 3 px.

## Ícones

Lucide (licença ISC, `lucide-react`), traço 1,75 (1,5 em 16 px), tamanhos 16/20/24, cor `currentColor`. Dicionário: buscar `search`, camadas `layers`, opções `sliders-horizontal`, filtrar `funnel`, lugar `map-pin`, minha localização `locate-fixed`, foto da rua `camera`, maquete 3D `box`, medir `ruler`, compartilhar `share-2`, favoritar `star`, informação `info`, fechar `x`, adicionar `plus`, importar `upload`.

## Componentes

Cada um tem prancheta própria na biblioteca, com estados (normal, passar o mouse, foco, pressionado, desativado, carregando) nos dois temas:

- Átomos: botão (principal, secundário, discreto, perigo, só ícone, redondo do mapa), campo de texto (texto, busca, seleção, número com unidade, data), chip (filtro, opção, categoria, etiqueta), checkbox/rádio/interruptor.
- Moléculas: seletor segmentado e abas, busca com sugestões, item de camada/resultado e legendas, seção da barra lateral com filtro em árvore, mensagens (aviso, dica, vazio, esqueleto, progresso).
- Mapa: marcadores e rótulos, cartão do lugar, controles do mapa.

Regra de ouro (2026-10-14): **nenhuma informação como texto solto**. Cada dado ganha um componente pelo que ele é:

- **Campo** (`FieldRows`): ícone em círculo + rótulo pequeno + valor, agrupado em Contato · Detalhes · Sobre o dado. O tipo vem do nome da coluna e do valor: site e redes viram link com o nome ("Facebook"), telefone formatado e clicável, e-mail clicável, data "17 de set. de 2026", nota 0–1 de confiança vira medidor (Alta/Média/Baixa), endereço/cidade/UF com alfinete, códigos técnicos (`professional_service`) em texto. Vale para qualquer planilha.
- **Indicador** (`Metric`): rótulo inteiro em cima, número grande e unidade curta ao lado ("0,8 %", não "0,8 Proporção (%)").
- **Barra empilhada** (`CategoryStack`): as 3 maiores categorias e "outras", com legenda e números.
- **Selo** sobre foto (distância), **balão ⓘ** (`InfoTip`) para crédito, licença e de onde veio o dado, **etiqueta de origem** (Público / Seu dado).
- **Widget**: cartão branco dentro da janela solta; números de destaque em `widget-stats`, barras em `widget-bars`, aviso em `widget-note`, vazio com ícone + título + o que fazer.

## Estrutura da tela

Inspirada no CARTO Builder: regiões claras, uma tarefa por painel, hierarquia forte.

- Barra superior: marca, perspectiva 2D/3D, botão do painel "Na tela", Compartilhar (principal).
- Trilho de ícones (76 px): Camadas, Adicionar, Detalhes, Ajustes.
- Painel (360 px) sobre `--cv-surface`, com cartões `--cv-float` de cantos 12 px; cada camada é um cartão com letra, nome, fonte/quantidade, olho, menu ⋯ e legenda. A legenda de categorias é o filtro da camada: clicar liga/desliga, "só" isola uma, "Mostrar todas" limpa; o filtro vale no mapa, em "Na tela" (selo *filtrado*) e no "Por perto" do cartão do clique, e fica lembrado no navegador. Abaixo da legenda, "Filtrar por valor" cria condições por coluna (faixa numérica De/Até ou texto "contém"), mostradas como chips; em datasets em tiles valem só nos pontos (os hexágonos não têm as colunas). Filtros vão junto no link de compartilhar.
- Marcadores com ícone: ao aproximar (zoom ≥ 16), pontos de datasets com `CityMap.setDatasetIcons` viram círculo da cor da categoria com ícone Lucide branco; a legenda mostra o mesmo marcador em miniatura. Estabelecimentos usa um ícone por grupo (`apps/web/src/placeIcons.tsx`) e alfinete para "Outros".
- Camadas de apoio (cobertura de fotos de rua) ficam abaixo dos pontos e discretas.
- Padrões ao abrir: Estabelecimentos e Fotos de rua ligados; coropléticos (municípios, UFs, biblioteca) nunca abrem ligados, ficam no projeto com o olho fechado.
- Mapa no centro, com a busca flutuando no canto superior esquerdo.
- "Na tela" (320 px) à direita: contagem visível e barras por categoria de cada camada de pontos.
