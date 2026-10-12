# Pôr o City View no ar

Uma VM Linux só (Ubuntu 24.04, ARM ou x86) roda tudo: site, demo do SDK, API em Rust e os tiles.
Decisão e alternativas: [ADR 0001](adr/0001-hospedagem-vm-unica.md).

```
navegador ──HTTPS──▶ Caddy (:443, certificado automático)
                      ├─ /            site (apps/web/dist)
                      ├─ /demo/       demo do SDK
                      ├─ /data/*      tiles e dados públicos (/opt/cityview/data, com Range)
                      └─ /api/*  ──▶  cityview-api (:8787, systemd) → /opt/cityview/workspace
```

## Máquina

Oracle Cloud Always Free: `VM.Standard.A1.Flex`, 2 OCPU, 12 GB, Ubuntu 24.04, disco de 150 GB,
região São Paulo ou Vinhedo. Passo a passo da conta e da VM: veja "Oracle, do zero" abaixo.
Qualquer VPS com 2 GB+ de memória e 20 GB+ de disco também serve (a compilação do Rust é a parte pesada).

Na rede do provedor, libere TCP 80 e 443 de `0.0.0.0/0` (na Oracle: Subnet → Security List → Ingress Rules).

## Instalar (uma vez)

Na VM, logado por SSH:

```
curl -fsSL https://raw.githubusercontent.com/yagpdc/city_view/main/deploy/install.sh | sudo bash -s -- --mapillary SEU_TOKEN_DE_CLIENTE
```

- Sem `--site`, o endereço é `https://<ip-com-traços>.sslip.io` (HTTPS grátis, sem comprar domínio).
  Com domínio próprio: aponte um registro A para o IP da VM e use `--site meudominio.com.br`.
- `--mapillary`: o token **de cliente** (o mesmo de `apps/web/.env.local`). Nunca o client secret.
- No fim, o script pede uma senha: é a que o site pede para enviar, renomear ou apagar datasets no servidor.
  Ver o mapa é público.

## Enviar os dados

Os tiles não estão no git. Do Windows, na raiz do repositório:

```powershell
.\deploy\publish-data.ps1 -Ip SEU_IP
```

Envia base do mapa, fontes, datapacks, Estabelecimentos e o exemplo (~2,5 GB). `-Only places` manda só
uma parte; `-Workspace` inclui os datasets que você processou no servidor local.

## Atualizar

Depois de um `git push`:

```
ssh -i ~/.ssh/oracle_cityview ubuntu@SEU_IP sudo bash /opt/cityview/src/deploy/update.sh
```

## Onde fica cada coisa na VM

| Caminho | O quê |
|---|---|
| `/opt/cityview/src` | clone do repositório (compila aqui) |
| `/opt/cityview/web`, `/demo` | site e demo gerados |
| `/opt/cityview/data` | tiles públicos (enviados por `publish-data.ps1`) |
| `/opt/cityview/workspace/datasets` | datasets enviados ao servidor (API) |
| `/etc/caddy/Caddyfile` | gerado de `deploy/Caddyfile` |

Logs: `journalctl -u cityview-api -f` · `journalctl -u caddy -f`.

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
