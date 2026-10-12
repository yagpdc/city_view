// Gera packages/tiler-wasm/pkg: crates/tiler-wasm → wasm32 → wasm-bindgen (--target web).
// Uso: pnpm wasm. Precisa de `rustup target add wasm32-unknown-unknown` e wasm-bindgen-cli 0.2.95
// (no PATH ou em target/tools/bin, via `cargo install wasm-bindgen-cli --version 0.2.95 --root target/tools`).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const exe = process.platform === "win32" ? ".exe" : "";
const local = `${root}target/tools/bin/wasm-bindgen${exe}`;
const bindgen = existsSync(local) ? local : `wasm-bindgen${exe}`;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

run("cargo", ["build", "-p", "tiler-wasm", "--target", "wasm32-unknown-unknown", "--release"]);
// O app passa a URL do .wasm (import "?url" do Vite), então o caminho padrão sai do JS gerado.
run(bindgen, ["--target", "web", "--omit-default-module-path", "--out-dir", "packages/tiler-wasm/pkg", "target/wasm32-unknown-unknown/release/tiler_wasm.wasm"]);
console.log("[wasm] packages/tiler-wasm/pkg pronto");
