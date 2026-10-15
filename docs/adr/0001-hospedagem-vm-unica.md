# ADR 0001 — Hospedagem: uma VM com Caddy, API e tiles

- Data: 2026-10-12
- Estado: aceita

## Contexto

O City View roda local. Para pôr no ar com orçamento zero (nada pago até gerar receita), precisamos servir:
o site estático, a demo do SDK, ~2,5 GB de PMTiles com Range requests e a API em Rust que recebe arquivos
e processa com o tiler (CPU e memória por minutos).

## Decisão

Uma VM Linux (Oracle Cloud Always Free, ARM Ampere A1, 2 OCPU / 12 GB, 200 GB de disco grátis):

- **Caddy** na frente: HTTPS automático (Let's Encrypt), site/demo/tiles do disco, `/api` por proxy.
  Sem domínio, `<ip>.sslip.io` dá HTTPS de graça.
- **pinny-api** como serviço systemd, só escrevendo em `/opt/pinny/workspace`.
- Escrita na API (enviar, renomear, apagar) protegida por senha no Caddy; leitura pública.
- Código compilado na própria VM (`deploy/update.sh`: git pull, pnpm build, cargo build). Dados enviados
  do PC por `deploy/publish-data.ps1` (não estão no git).

## Alternativas

- **Site + tiles em CDN de objetos (Cloudflare Pages + R2)**: ótimo para o que é público (sem servidor,
  sem cobrança de tráfego), mas não roda a API de ingestão. Boa evolução quando o tráfego crescer:
  `/data` vai para o R2 e a VM fica só com a API.
- **Free tiers pequenos (GCP e2-micro, 1 GB de RAM)**: não compilam nem processam datasets grandes.
- **VPS pago barato (ex.: Hetzner ARM)**: mesmo desenho, sem o risco de capacidade/conta da Oracle;
  fica como plano B quando houver orçamento.

## Consequências

- Um ponto único de falha e sem backup automático (próximo passo: backup do workspace).
- Limites da Oracle mudam (o grátis ARM caiu de 4/24 para 2/12 em 2026); o desenho não depende da Oracle.
- Se o tráfego crescer, os tiles saem da VM primeiro (CDN), depois a API escala separada.
