#!/usr/bin/env bash
# Instala o City View numa VM Ubuntu 24.04 (x86_64 ou ARM, ex.: Oracle Cloud Ampere A1).
#
#   curl -fsSL https://raw.githubusercontent.com/yagpdc/city_view/main/deploy/install.sh | sudo bash
#
# Opções (depois de `sudo bash -s --`):
#   --site <endereço>     domínio do site (padrão: <ip-público>.sslip.io, HTTPS grátis sem comprar domínio)
#   --mapillary <token>   token de CLIENTE do Mapillary (fotos de rua); sem ele a camada fica desligada
#   --with-api            também instala a API de ingestão (guarda datasets no servidor). Por padrão NÃO:
#                         dados do usuário são processados só no navegador (docs/adr/0002).
#   --admin <usuário>     com --with-api: usuário que pode enviar/apagar datasets (padrão: admin)
#
# Rodar de novo é seguro: atualiza o código, recompila e reinicia.
set -euo pipefail

REPO_URL="https://github.com/yagpdc/city_view.git"
ROOT=/opt/pinny
SITE=""
MAPILLARY=""
ADMIN_USER="admin"
WITH_API=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --mapillary) MAPILLARY="$2"; shift 2 ;;
    --admin) ADMIN_USER="$2"; shift 2 ;;
    --with-api) WITH_API=1; shift ;;
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

say "Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates build-essential pkg-config debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent

if ! command -v caddy >/dev/null; then
  say "Caddy (servidor web com HTTPS automático)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
  say "Node.js 22 (para gerar o site)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
corepack enable

say "Usuário e pastas"
id pinny >/dev/null 2>&1 || useradd --system --create-home --home-dir "$ROOT/home" --shell /usr/sbin/nologin pinny
mkdir -p "$ROOT"/{src,web,demo,bin,data,workspace/datasets}
chown -R pinny:pinny "$ROOT/src" "$ROOT/home" "$ROOT/workspace" "$ROOT/bin" "$ROOT/web" "$ROOT/demo"
# Dados públicos (tiles) chegam por scp com o usuário de login (ex.: ubuntu); o Caddy só lê.
LOGIN_USER="${SUDO_USER:-ubuntu}"
chown "$LOGIN_USER":"$LOGIN_USER" "$ROOT/data"
chmod 755 "$ROOT" "$ROOT/data" "$ROOT/web" "$ROOT/demo"

echo "$WITH_API" > "$ROOT/with-api"
if [[ $WITH_API == 1 && ! -x "$ROOT/home/.cargo/bin/cargo" ]]; then
  say "Rust (para compilar o servidor)"
  sudo -u pinny -H bash -c 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal'
fi

say "Código"
if [[ -d "$ROOT/src/.git" ]]; then
  sudo -u pinny -H git -C "$ROOT/src" pull --ff-only
else
  sudo -u pinny -H git clone --depth 1 "$REPO_URL" "$ROOT/src"
fi
if [[ -n "$MAPILLARY" ]]; then
  echo "VITE_MAPILLARY_TOKEN=$MAPILLARY" > "$ROOT/src/apps/web/.env.production.local"
  chown pinny:pinny "$ROOT/src/apps/web/.env.production.local"
fi

say "Firewall interno (a imagem da Oracle bloqueia 80/443)"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null

if [[ -z "$SITE" ]]; then
  IP=$(curl -fsS https://api.ipify.org)
  SITE="${IP//./-}.sslip.io"
fi

if [[ $WITH_API == 1 ]]; then
  say "Serviço da API"
  install -m 644 "$ROOT/src/deploy/pinny-api.service" /etc/systemd/system/pinny-api.service
  systemctl daemon-reload
fi

say "Compilação (a primeira vez leva uns 10–15 min)"
bash "$ROOT/src/deploy/update.sh"

say "Caddy em https://$SITE"
if [[ $WITH_API == 1 ]]; then
  HASH_FILE="$ROOT/admin.hash"
  if [[ ! -s "$HASH_FILE" ]]; then
    echo "Escolha a senha de '$ADMIN_USER' (para enviar/apagar datasets pelo site):"
    read -rs PASSWORD </dev/tty
    caddy hash-password --plaintext "$PASSWORD" > "$HASH_FILE"
    chmod 600 "$HASH_FILE"
  fi
  sed -e "s|__SITE__|$SITE|" -e "s|__ADMIN_USER__|$ADMIN_USER|" -e "s|__ADMIN_HASH__|$(cat "$HASH_FILE")|" -e "/SEM-API/d" \
    "$ROOT/src/deploy/Caddyfile" > /etc/caddy/Caddyfile
else
  # Sem API: o bloco /api some (o site detecta e esconde "enviar ao servidor").
  sed -e "s|__SITE__|$SITE|" -e '/# API-INICIO/,/# API-FIM/d' -e '/# SEM-API/d' -e 's/^#SEM-API//' "$ROOT/src/deploy/Caddyfile" > /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable --now caddy
systemctl reload caddy

say "Pronto"
echo "Site: https://$SITE"
echo "Falta enviar os dados (tiles): no Windows, rode deploy/publish-data.ps1 (docs/DEPLOY.md)."
