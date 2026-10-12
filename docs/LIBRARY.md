# Biblioteca de dados

A City View não produz nem hospeda dados de terceiros. A **biblioteca** é um índice pesquisável de fontes públicas: o usuário encontra uma tabela/série, baixa direto da fonte oficial ou coloca no mapa — o dado vai da fonte para o navegador, sem passar por nós.

Começa pelo Brasil e foi desenhada para crescer para qualquer fonte e país.

## Peças

```
datapacks/library/
  build.py              roda os construtores de índice (todos ou os indicados)
  common.py             formato comum + atualização do index.json
  sources/<fonte>.py    um construtor por fonte (lê a API da fonte, gera o índice)
  index.json            lista de fontes (pequeno, carregado primeiro)
  <fonte>.json          índice da fonte (carregado sob demanda)

apps/web/src/library/
  types.ts              formato decodificado
  load.ts               carrega index e fontes
  adapters/<adapter>.ts o que cada fonte sabe fazer: baixar CSV, dados por município p/ o mapa
  LibraryPanel.tsx      busca e ações
```

## Formato do índice de uma fonte (`schema: 1`)

```jsonc
{
  "schema": 1,
  "source": {
    "id": "ibge-sidra",                 // único
    "name": "IBGE · SIDRA",
    "publisher": "IBGE",
    "country": "BR",
    "description": "…",
    "homepage": "https://sidra.ibge.gov.br",
    "itemUrl": "https://sidra.ibge.gov.br/tabela/{id}",   // null quando a fonte não tem página por item
    "license": "…",
    "adapter": "sidra",                 // qual adaptador do front sabe falar com a fonte
    "groupLabel": "Pesquisa",           // como a fonte chama seus agrupamentos
    "updatedAt": "…"
  },
  "groups":   [{ "id": "…", "name": "…" }],
  "subjects": ["…"],
  // Compacto: [id, título, grupo, assunto (-1), ano inicial, ano final, flags]
  "items": [["4714", "População…", 4, 33, 2022, 2022, 5]]
}
```

**Flags** (bits): `1` tem dado por município · `2` tem recorte regional (UF etc.) mas município incerto · `4` download direto disponível.

## Adaptadores

```ts
interface LibraryAdapter {
  /** Baixa e salva um CSV (direto da fonte). */
  download(item, source): Promise<DownloadResult>;
  /** Valores por município (código IBGE de 7 dígitos) do período mais recente, para o mapa. */
  municipal?(item, source): Promise<MunicipalData>;
}
```

| Fonte | Adaptador | Download | Mapa | Observações |
|---|---|---|---|---|
| IBGE SIDRA | `sidra` | recorte mais detalhado + período mais recente | sim (tabelas com N6) | API aceita recorte/período na consulta |
| Ipeadata | `ipeadata` | série completa | sim (séries regionais com municípios) | API devolve sempre a série inteira (pode ter dezenas de MB) |

## Próximas fontes (Brasil)

INPE (queimadas, desmatamento PRODES/DETER), DATASUS (CNES, mortalidade), INEP (censo escolar), ANATEL, ANP, TSE (eleições por seção), Banco Central (SGS), dados.gov.br (CKAN), MapBiomas. Depois: fontes internacionais (Banco Mundial, Eurostat, US Census).

## Princípios

- Só índice e links/consultas à fonte oficial; licença e atribuição sempre visíveis.
- Download e mapa rodam no navegador do usuário, direto da fonte (CORS) — sem custo nem intermediário.
- Cada fonte declara honestamente o que dá para fazer; o que não der, cai no link da fonte.
