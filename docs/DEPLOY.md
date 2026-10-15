# Pôr o Pinny no ar

Uma VM Linux só (Ubuntu 24.04, ARM ou x86) entrega o site, a demo do SDK e os tiles públicos.
**Arquivos do usuário não vão para o servidor**: são processados no navegador ([ADR 0002](adr/0002-dados-do-usuario-so-no-navegador.md)),
então a API de ingestão não roda em produção. A API de produto (contas, espaços de trabalho, projetos) ainda vai ser
desenhada e entra aqui quando existir. Hospedagem: [ADR 0001](adr/0001-hospedagem-vm-unica.md).

```
navegador ──HTTPS──▶ Caddy (:443, certificado automático)
                      ├─ /            site (apps/web/dist)
                      ├─ /demo/       demo do SDK
                      ├─ /data/*      tiles e dados públicos (/opt/pinny/data, com Range)
                      └─ /api/*       404 (só com --with-api: pinny-api, uso interno)
```

## Máquina

Oracle Cloud Always Free: `VM.Standard.A1.Flex`, 2 OCPU, 12 GB, Ubuntu 24.04, disco de 150 GB,
região São Paulo ou Vinhedo. Passo a passo da conta e da VM: veja "Oracle, do zero" abaixo.
Qualquer VPS com 1 GB+ de memória e 20 GB+ de disco também serve (sem a API, nem compila Rust).

Na rede do provedor, libere TCP 80 e 443 de `0.0.0.0/0` (na Oracle: Subnet → Security List → Ingress Rules).

## Instalar (uma vez)

Na VM, logado por SSH:

```
curl -fsSL https://raw.githubusercontent.com/yagpdc/city_view/main/deploy/install.sh | sudo bash -s -- --mapillary SEU_TOKEN_DE_CLIENTE
```

- Sem `--site`, o endereço é `https://<ip-com-traços>.sslip.io` (HTTPS grátis, sem comprar domínio).
  Com domínio próprio: aponte um registro A para o IP da VM e use `--site meudominio.com.br`.
- `--mapillary`: o token **de cliente** (o mesmo de `apps/web/.env.local`). Nunca o client secret.
- `--with-api` (uso interno, não para dados de usuários): instala também a API de ingestão; o script pede
  a senha exigida para enviar, renomear ou apagar datasets. Ver o mapa é sempre público.

## Enviar os dados

Os tiles não estão no git. Do Windows, na raiz do repositório:

```powershell
.\deploy\publish-data.ps1 -Ip SEU_IP
```

Envia base do mapa, fontes, datapacks, Estabelecimentos e o exemplo (~2,5 GB). `-Only places` manda só
uma parte; `-Workspace` (só com `--with-api`) inclui os datasets processados no servidor local.

## Atualizar

Depois de um `git push`:

```
ssh -i ~/.ssh/oracle_cityview ubuntu@SEU_IP sudo bash /opt/pinny/src/deploy/update.sh
```

## Onde fica cada coisa na VM

| Caminho | O quê |
|---|---|
| `/opt/pinny/src` | clone do repositório (compila aqui) |
| `/opt/pinny/web`, `/demo` | site e demo gerados |
| `/opt/pinny/data` | tiles públicos (enviados por `publish-data.ps1`) |
| `/opt/pinny/workspace/datasets` | datasets enviados ao servidor (API) |
| `/etc/caddy/Caddyfile` | gerado de `deploy/Caddyfile` |

Logs: `journalctl -u pinny-api -f` · `journalctl -u caddy -f`.

## Oracle, do zero

1. Conta: <https://signup.cloud.oracle.com/>. Cartão de crédito **físico** (virtual/pré-pago é recusado),
   compras internacionais liberadas, endereço igual ao do banco. Região: São Paulo ou Vinhedo (não muda depois).
   "Número de solicitações excedido" = bloqueio temporário por tentativas; espere horas antes de tentar de novo.
2. Billing & Cost Management → Budgets → orçamento de 1 com alerta por e-mail.
3. Upgrade para Pay As You Go (link no topo do painel): segue grátis dentro dos limites e evita que a VM
   ociosa seja recolhida.
4. Chave SSH no Windows: `ssh-keygen -t ed25519 -f $HOME\.ssh\oracle_cityview` (a privada nunca sai do PC).
5. Compute → Instances → Create: Ubuntu 24.04, shape Ampere `VM.Standard.A1.Flex` 2 OCPU / 12 GB,
   VCN nova com IP público, cole a chave `.pub`, boot volume 150 GB. "Out of capacity": tente outro horário.
6. Subnet → Security List → Ingress: TCP 80,443 de `0.0.0.0/0`.
7. Opcional: Networking → Reserved Public IPs, para o IP não mudar.
8. `ssh -i $HOME\.ssh\oracle_cityview ubuntu@SEU_IP` e siga "Instalar".
