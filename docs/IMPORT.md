# Importação de dados — o builder

> Status: proposta (2026-10-12). Substitui o assistente atual (Arquivo → Localização → Colunas → Revisão)
> aos poucos, fase a fase.

A planilha do usuário é a porta de entrada do produto. Objetivo: **qualquer planilha razoável entra no mapa**,
e quem quiser chega lá **com o dado já pronto** (limpo, padronizado, com as categorias e números do jeito
que quer ver). Quem não quiser, **sobe direto** e ajusta depois.

Princípios:

- **Tudo no navegador do usuário.** O servidor não recebe nem guarda o que ele sobe (ADR 0002). Arquivo,
  receita e camadas ficam no armazenamento do navegador (IndexedDB/OPFS) e somem se ele limpar os dados do
  site, usar janela anônima ou trocar de computador. Isso aparece **com clareza** na importação, no painel de
  camadas ("neste navegador") e antes de qualquer ação que apague. Saída: **Baixar cópia** do projeto
  (arquivo `.cityview` com dados + receitas + mapa) e **Abrir cópia** para restaurar — ou levar a outro computador.
- **Planilha incompatível não é beco sem saída.** Se faltar algo (localização, colunas, formato), o assistente
  diz o que falta em português, mostra onde, e oferece como resolver ali mesmo: escolher outra coluna, criar
  uma coluna nova, corrigir valores, ou **juntar com outra planilha** que tenha o que falta.
- **Nada é destrutivo.** O arquivo original fica intacto (no navegador, ADR 0002); o que o usuário faz é uma
  **receita** — uma lista de passos aplicados em ordem — que pode ser desfeita, reordenada e **reaplicada**
  quando ele subir a versão do mês que vem da mesma planilha.
- **Mostrar antes de aplicar.** Cada passo diz quantas linhas afeta e mostra o antes/depois na amostra.
- **Sugerir, não obrigar.** Detectamos tipos, problemas e correções prováveis; o usuário aceita com um clique.
- **Escala.** A edição é feita numa amostra (rápida); ao importar, a receita roda no arquivo inteiro, no worker,
  aos pedaços (milhões de linhas).

## O que a planilha precisa ter

Uma linha = um registro. Obrigatório: **uma forma de localização**. O resto é opcional.

| Localização | Precisão | Fase |
|---|---|---|
| Latitude + longitude (inclusive numa coluna só, em graus/minutos/segundos, com vírgula decimal) | ponto | 1 |
| Geometria (GeoJSON, GeoParquet, KML, Shapefile zipado) | ponto/área | 1 (KML/SHP) |
| Município + UF, código IBGE, UF | área (planilha de território) | 3 |
| CEP | ponto aproximado | 3 (CNEFE) |
| Endereço | ponto | 3 (CNEFE) |

Opcionais: nome (rótulo e busca), categoria (cor e filtro), números (tamanho, faixas, soma), data (tempo), ID
(atualizar a mesma camada).

## Fluxo

1. **Soltar o arquivo** → lemos, detectamos e mostramos a **pré-montagem**: a tabela com o tipo de cada coluna,
   a localização encontrada e um mini-mapa com a amostra.
2. Dois botões: **Subir direto** (aceita o que detectamos) ou **Ajustar os dados** (abre o builder).
3. **Builder**: grade da planilha (virtualizada) + painel da coluna selecionada + receita (lista de passos) +
   mini-mapa ao vivo.
4. **Revisão**: quantas linhas entram, quantas ficam de fora e por quê (baixar as que falharam), prévia no mapa.
5. Importar. No cartão da camada: **Editar dados** reabre o builder com a mesma receita; **Atualizar com nova
   planilha** reaplica a receita no arquivo novo.

   > **Estado (2026-10-13):** ✅ a camada guarda como foi montada (`SavedImport` no IndexedDB, junto com ela): o arquivo
   > original (até 100 MB; acima disso, ou sem espaço, pedimos o arquivo de novo), as planilhas de juntar/acrescentar,
   > a receita, a localização, as colunas, título e cor. **Editar dados** reabre no passo Dados; **Atualizar com nova
   > planilha** aplica tudo no arquivo novo e vai direto à revisão, ou para no passo Localização avisando quais colunas
   > a planilha nova não tem. A camada é substituída no lugar (mesmo id, filtros e cartão).

## Perfil da coluna (o que o builder mostra ao clicar numa coluna)

Tipo detectado e confiança · vazios · valores distintos · mín/máx/média · histograma (números) ou os valores
mais comuns (texto) · **problemas encontrados** (ex.: "37 valores com R$", "CEP sem zero à esquerda",
"8 grafias de São Paulo") com a correção sugerida.

## Passos da receita

**Colunas** — renomear · mudar tipo · esconder/mostrar · reordenar · dividir ("Campinas/SP" → cidade, UF) ·
juntar (rua + número + cidade → endereço) · extrair por padrão (CEP, número, código) · coluna calculada
(a × b, a ÷ b, a − b; texto + texto).

**Limpeza** — aparar espaços · maiúsculas/minúsculas/título · tirar acentos · vazios → valor padrão ·
**unificar grafias** (agrupa valores parecidos: "SP", "S.Paulo", "são paulo" → escolhe um) · remover duplicados
(pela coluna ID ou pela linha inteira).

**Números** — arredondar (casas decimais, para múltiplo de 5/10/100) · **faixas** (0–10, 10–20…; faixas iguais,
quantis ou definidas à mão) · limitar a um intervalo · converter unidade/escala · % e moeda → número.

**Recodificar** — tabela de valores: "x, y → z" (com sugestão a partir dos distintos).

**Regras e tags** — criar uma coluna nova por condições: *se UF = PR e faturamento > 1 mi → "Indústria
grande"*, senão … · condições E/OU sobre qualquer coluna · várias regras em ordem (a primeira que bate vence)
· tags múltiplas (uma linha pode ter várias).

**Linhas** — filtrar (manter só/remover as que…) · amostra · ordenar (só para a visualização).

**Juntar com outra planilha** — completar a planilha atual (ou uma camada já no mapa) com colunas de outro
arquivo, casando por uma coluna-chave (CNPJ, código, nome normalizado): "as empresas estão nesta, as
localizações naquela". Mostra quantas linhas casaram, quantas não, e as que bateram mais de uma vez (escolher
a primeira, somar, contar…). Também **acrescentar linhas** de outro arquivo com as mesmas colunas (ex.: as lojas
de outra região), alinhando colunas de nomes diferentes.

> **Estado (2026-10-12):** ✅ juntar e acrescentar funcionando (passos `join` e `append`, `packages/importer/src/join.ts`).
> Chave tolerante (pontuação, caixa, acentos, zeros à esquerda), sugestão da dupla de colunas pelos valores, balanço
> (casaram / mais de um par / sem valor / exemplos sem par), primeira linha ou soma, coluna de contagem. "Juntar"
> aparece também no passo Arquivo quando a planilha não tem coordenadas ("as coordenadas estão em outra planilha").
> "Acrescentar" entra no começo da receita, então os ajustes valem para as linhas novas. A outra planilha fica só na
> memória do worker; vale também para arquivos grandes lidos aos pedaços (`appendedRows`). Juntar com uma **camada já
> no mapa** ainda não.

**Datas** — reconhecer formatos (inclusive número de série do Excel) · extrair ano, mês, dia da semana.

**Localização** — escolher as colunas · trocar lat/lon invertidas · corrigir escala (−2356000 → −23,56) ·
graus/minutos/segundos → decimal · território/CEP/endereço (fase 3).

Os passos de mapa (cor por categoria, tamanho por número, título) continuam na importação, mas podem nascer
do builder: "colorir por esta coluna" no menu da coluna.

## Casos difíceis (o que precisa funcionar)

Arquivo: codificação (UTF-8, Windows-1252, com/sem BOM) · separador (, ; tab |) · aspas e quebras de linha
dentro do campo · cabeçalho que não está na 1ª linha (títulos e linhas em branco acima) · cabeçalhos repetidos ou
vazios · colunas e linhas totalmente vazias · Excel com várias abas (escolher), células mescladas, fórmulas
(usar o valor), datas como número de série · `.xls` antigo e `.ods` (avisar/ converter) · arquivo protegido por
senha (avisar) · arquivo vazio · arquivo enorme (amostra + leitura em colunas).

Valores: "1.234,56" vs "1,234.56" na mesma planilha · "R$ 1.234", "12%", "1,2 mil" · "sim/não",
"S/N", "verdadeiro" · CEP sem zero à esquerda (1310200 → 01310-200) · código IBGE com 6 ou 7 dígitos · nomes
de município com e sem acento, "Mogi-Mirim" × "Mogi Mirim" · coluna com tipos misturados · texto muito longo ·
espaços invisíveis.

Coordenadas: invertidas · zeradas (0,0) · sem ponto decimal · numa coluna só ("lat, lon") · em graus/minutos ·
fora do Brasil (avisar, não bloquear) · repetidas (vários registros no mesmo ponto: agrupar/espalhar).

## Riscos: o que pode quebrar na mão do cliente

Análise de 2026-10-12. Impacto: **perda silenciosa** (o dado entra errado e ninguém percebe) é pior que erro
explícito. Estado: ✅ tratado · ◐ parcial · ❌ não tratado. A ordem de ataque segue a coluna "prioridade".

### Perda silenciosa de dado (prioridade máxima)

| Caso | Por que acontece | Estado |
|---|---|---|
| **CNPJ, CPF, telefone, código de barras como número** | Detectados como "Número" → viram float: zeros à esquerda somem e acima de 15 dígitos os últimos mudam | ✅ detectados (nome, máscara, zero à esquerda, 12+ dígitos) e mantidos como texto; nunca sugerimos "virar número" |
| **Excel já estragou o valor**: `1,23457E+13`, CEP `1310200`, IBGE `350950` | O Excel converteu antes de chegar a nós | ✅ CEP corrigido; notação científica avisada (não dá para recuperar) |
| **Linha de total/subtotal** no fim ("Total", "Soma") | Vira um registro com valor gigante | ✅ detectada na abertura, remoção em um clique (passo de receita) |
| **Cabeçalho repetido no meio** (relatório paginado) e rodapé ("Fonte: …") | Viram registros | ✅ detectados na abertura, remoção em um clique |
| **Cabeçalho em duas linhas** (célula mesclada "Endereço" sobre "Rua / Número") | Nomes de coluna errados | ❌ detectar e combinar ("Endereço · Rua") |
| **Excel com porcentagem guardada como 0,12** (mostra 12%) | Lemos o valor real 0,12 | ❌ ler o formato da célula; perguntar ×100 |
| **Erros de fórmula** `#N/D`, `#REF!`, `#DIV/0!`, `#VALOR!` | Viram texto, estragam a coluna numérica | ✅ contam como vazio |
| **Marcadores de vazio**: "-", "N/A", "n/d", "NULL", "nan", "sem informação", "0" usado como vazio | Viram categorias ou números | ✅ problema na coluna com "Tratar como vazio" |
| **Coordenadas em UTM** (ex.: 333000; 7395000 — exportação de GIS, SIRGAS 2000 23S) | Fora de qualquer faixa: tudo é rejeitado ou cai no oceano | ✅ detectado; converte com o fuso escolhido (18–25 S) |
| **Coordenadas em metros (Web Mercator)** | Idem | ❌ detectar e reprojetar |
| **Um ponto absurdo** (erro de digitação: 0,5; 0,5) | Enquadramento mostra o mundo inteiro; parece que "não carregou" | ✅ enquadramento ignora os extremos; revisão avisa quantos pontos estão isolados |
| **Precisão baixa** (coordenadas inteiras ou 1 casa) | Centenas de registros empilhados num ponto | ❌ avisar "N registros no mesmo lugar" e oferecer espalhar/agrupar |
| **Categoria com mais de 65 mil valores** em arquivo grande | Excedente fica vazio | ◐ avisar quando acontecer |
| **Coluna chamada `_c`** (ou outros nomes internos) | Sobrescreve a categoria interna nos tiles | ✅ renomeada para `_c_coluna` |
| **Dois formatos de número na mesma coluna** ("1.234,5" e "1,234.5") | Metade lida errada | ◐ avisar quando o formato da coluna for ambíguo |

### Arquivo que não abre ou abre errado

| Caso | Estado |
|---|---|
| CSV em **UTF-16** (Excel "Texto Unicode", com tab) — comum no Windows | ✅ detectado pela marca no começo do arquivo |
| `.xls` antigo, `.ods`, `.xlsb`, `.numbers` | ❌ mensagem clara ("salve como .xlsx ou .csv") |
| Excel protegido por senha | ❌ mensagem clara |
| Excel grande (> ~100 MB) — a biblioteca carrega tudo na memória | ❌ avisar e sugerir CSV; leitura em fluxo depois |
| Aspas não fechadas no CSV (uma linha "come" o resto) | ❌ detectar campos gigantes e apontar a linha |
| Separador dentro do valor sem aspas ("Rua A, 10") | ◐ linhas com colunas a mais: apontar |
| Delimitador no fim da linha (coluna vazia extra) | ✅ coluna vazia some |
| Arquivo só com cabeçalho / vazio | ✅ mensagem |
| JSON que não é GeoJSON, GeoJSON com CRS antigo (não WGS84) | ◐ JSON inválido ✅; CRS ❌ |
| Shapefile (.zip), KML/KMZ, GPX | ❌ fase 1 (KML/SHP) |
| Arquivo arrastado do e-mail/OneDrive ainda baixando (0 bytes) | ❌ mensagem |

### Navegador e escala

| Caso | Estado |
|---|---|
| **Espaço do navegador acabou** (cota do IndexedDB; Safari ~1 GB; janela anônima menor) | ◐ erro genérico → mensagem clara + quanto ocupa + apagar camadas antigas |
| **Navegador apaga os dados** (Safari após 7 dias sem uso; limpeza) | ◐ pedimos armazenamento persistente; falta avisar e oferecer "Baixar cópia" |
| Celular/tablet: pouca memória, sem arrastar arquivo | ❌ limite por aparelho; botão de escolher arquivo sempre visível |
| Importação longa sem **cancelar** | ❌ botão cancelar (encerra o worker) |
| Aba fechada no meio | ✅ nada fica pela metade (grava no fim) |
| Mesmo arquivo importado duas vezes | ❌ perguntar "substituir ou criar outra camada?" |
| Duas abas do app abertas | ◐ ver as mesmas camadas; recarregar ao mudar |
| Centenas de colunas (UI lenta) | ❌ busca e virtualização na lista de colunas |
| Mensagens técnicas (erro do motor em Rust/WASM) chegando ao usuário | ◐ traduzir para o que fazer |

### Dados sensíveis

| Caso | Estado |
|---|---|
| Colunas de CPF, e-mail, telefone de pessoas | ◐ ficam no navegador (ADR 0002); avisar ao compartilhar mapa/imagem e sugerir esconder a coluna |

### Como garantir

- **Corpus de planilhas-problema** (`packages/importer/src/corpus.test.ts`, 14 casos): um arquivo pequeno por caso acima, com o resultado
  esperado (linhas, tipos, avisos) — vira teste automático do importador e regressão a cada mudança.
- **Teste de fumaça no navegador** com os 5 piores casos (UTF-16, total no fim, CNPJ, UTM, Excel com 2 abas).
- **Nada de perda silenciosa**: cada transformação automática aparece como passo na receita (dá para ver e desfazer)
  e cada linha descartada entra no relatório com o motivo.

## Fases

1. **Pré-montagem + Subir direto + relatório de qualidade** (linhas que ficam de fora e por quê, download) +
   perfil da coluna + passos básicos de coluna e limpeza + os casos difíceis de arquivo e coordenada.
2. **Transformações**: arredondar, faixas, recodificar, regras/tags, filtros de linhas, coluna calculada;
   receita salva com a camada; **Editar dados** e **Atualizar com nova planilha**; **juntar com outra
   planilha** e **acrescentar linhas**; **Baixar/Abrir cópia** do projeto.
3. **Localização sem coordenada**: planilha de território (município/UF/código IBGE), CEP e endereço (CNEFE).
4. **Inteligência**: sugestões automáticas melhores (unificar grafias, detectar "é uma faixa", "é moeda"),
   descrever a regra em português ("transforme 'sim' em verdadeiro") e virar passo.

## Técnica (resumo)

- Receita = lista de passos serializável (JSON), versionada, aplicada por um interpretador puro em
  `packages/importer` (testável sem navegador), no worker. Amostra para a interface; arquivo inteiro aos pedaços
  ao importar (`stream.ts`).
- O arquivo original fica no navegador (OPFS) para reabrir o builder; nada vai ao servidor (ADR 0002).
- Grade virtualizada (dezenas de colunas × amostra de 5–50 mil linhas).
