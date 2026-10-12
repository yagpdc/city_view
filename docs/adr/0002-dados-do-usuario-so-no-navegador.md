# ADR 0002 — Arquivos do usuário são processados só no navegador

- Data: 2026-10-12
- Estado: aceita

## Contexto

O produto visualiza dados públicos e dados do próprio usuário (planilhas, SHP, GeoJSON, Parquet de lojas,
clientes, ativos…). Guardar esses arquivos num servidor traz responsabilidade (LGPD, vazamento, backup),
custo de armazenamento e processamento. Ao mesmo tempo, o produto vai precisar de uma API para outras
coisas: autenticação, espaços de trabalho, projetos salvos, compartilhamento.

## Decisão

**O servidor não guarda nem processa o conteúdo dos arquivos que o usuário sobe.** Leitura, agregação e
tiles desses arquivos acontecem no navegador (Web Workers), e o resultado fica no armazenamento do próprio
navegador (IndexedDB/OPFS).

**O servidor guarda o resto**: contas, espaços de trabalho, membros e permissões, e a *configuração* dos
projetos (camadas públicas, filtros, estilos, câmera, anotações). Uma camada do usuário entra no projeto só
como referência ao arquivo local (nome, tamanho, colunas, impressão digital), nunca com as linhas. Ao abrir o
projeto noutra máquina, o app pede para reabrir aquele arquivo e reaplica a configuração.

- A API atual (`services/api`, ingestão de arquivos) é a semente do **plano Enterprise** (abaixo); fora dele,
  fica para dev e para gerar datasets públicos/de exemplo (`deploy/install.sh` só com `--with-api`).
- A API de produto (auth, workspaces, projetos) é outro serviço, a desenhar; quando existir, entra no
  `deploy/` com o próprio banco (PostgreSQL).
- Compartilhar por link leva só camadas públicas e filtros (já era assim).

## Consequências

- Privacidade é argumento de produto: "seus arquivos não saem do seu computador".
- Armazenamento e custo do servidor crescem com o número de usuários e projetos, não com o volume de dados.
- **Lacuna a fechar**: hoje arquivos acima de ~20 MB dependem do tiler no servidor. Para manter a promessa de
  milhões de registros, o tiler precisa rodar no navegador (Rust → WASM num worker, gerando PMTiles no OPFS).
- Colaboração em equipe sobre o mesmo dado do usuário exige que cada pessoa tenha o arquivo — fora do Enterprise.

## Plano Enterprise (exceção contratada)

Clientes Enterprise podem optar por guardar e processar os dados no servidor: volumes maiores do que um
navegador aguenta, equipe vendo a mesma base, atualização por integração/API. Para isso não virar um segundo
produto:

- **Um motor, dois lugares**: o mesmo tiler (Rust) roda no navegador (WASM) e no servidor (nativo) e gera o
  mesmo PMTiles. O front não sabe de onde o tile veio.
- **Origem da camada é um detalhe**: a camada do projeto aponta para "arquivo local" (OPFS) ou "dado do
  workspace" (servidor); filtros, estilos, widgets e compartilhamento funcionam igual.
- **Isolamento por workspace** (armazenamento, cotas, permissões, apagar tudo sob pedido), contrato e
  termos de tratamento de dados (LGPD) próprios. Quando chegar a hora, ADR específico: onde fica o dado,
  criptografia, retenção, região.
