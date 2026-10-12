#!/usr/bin/env bash
# Atualiza o City View na VM: baixa o código, gera o site e a demo, compila a API e reinicia.
#   sudo bash /opt/cityview/src/deploy/update.sh
set -euo pipefail

ROOT=/opt/cityview
[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
as_app() { sudo -u cityview -H env PATH="$ROOT/home/.cargo/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd $ROOT/src && $1"; }

as_app "git pull --ff-only"
as_app "pnpm install --frozen-lockfile"
as_app "pnpm --filter @cityview/web build"
as_app "pnpm --filter @cityview/embed-demo exec vite build --base /demo/"
as_app "cargo build --release -p cityview-api"

# Troca o site de uma vez (sem página pela metade durante a cópia).
for app in web demo; do
  src="$ROOT/src/apps/$([[ $app == web ]] && echo web || echo embed-demo)/dist"
  rm -rf "$ROOT/$app.next" && cp -r "$src" "$ROOT/$app.next"
  rm -rf "$ROOT/$app.old" && mv "$ROOT/$app" "$ROOT/$app.old" && mv "$ROOT/$app.next" "$ROOT/$app"
  rm -rf "$ROOT/$app.old"
  chmod -R a+rX "$ROOT/$app"
done
install -o cityview -g cityview -m 755 "$ROOT/src/target/release/cityview-api" "$ROOT/bin/cityview-api"

systemctl enable cityview-api >/dev/null 2>&1
systemctl restart cityview-api
echo "Atualizado: $(git -C "$ROOT/src" log --oneline -1)"
