#!/usr/bin/env bash
# Atualiza o City View na VM: baixa o código, gera o site e a demo, compila a API e reinicia.
#   sudo bash /opt/pinny/src/deploy/update.sh
set -euo pipefail

ROOT=/opt/pinny
[[ $EUID -eq 0 ]] || { echo "rode com sudo" >&2; exit 1; }
as_app() { sudo -u pinny -H env PATH="$ROOT/home/.cargo/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd $ROOT/src && $1"; }

as_app "git pull --ff-only"
as_app "pnpm install --frozen-lockfile"
as_app "pnpm --filter @pinny/web build"
as_app "pnpm --filter @pinny/embed-demo exec vite build --base /demo/"
WITH_API=$(cat "$ROOT/with-api" 2>/dev/null || echo 0)
[[ $WITH_API == 1 ]] && as_app "cargo build --release -p pinny-api"

# Troca o site de uma vez (sem página pela metade durante a cópia).
for app in web demo; do
  src="$ROOT/src/apps/$([[ $app == web ]] && echo web || echo embed-demo)/dist"
  rm -rf "$ROOT/$app.next" && cp -r "$src" "$ROOT/$app.next"
  rm -rf "$ROOT/$app.old" && mv "$ROOT/$app" "$ROOT/$app.old" && mv "$ROOT/$app.next" "$ROOT/$app"
  rm -rf "$ROOT/$app.old"
  chmod -R a+rX "$ROOT/$app"
done
if [[ $WITH_API == 1 ]]; then
  install -o pinny -g pinny -m 755 "$ROOT/src/target/release/pinny-api" "$ROOT/bin/pinny-api"
  systemctl enable pinny-api >/dev/null 2>&1
  systemctl restart pinny-api
fi
echo "Atualizado: $(git -C "$ROOT/src" log --oneline -1)"
