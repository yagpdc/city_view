import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin, type ViteDevServer } from "vite";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const DEMO_ROOT = fileURLToPath(new URL("../apps/embed-demo", import.meta.url));
const API_HEALTH = "http://127.0.0.1:8787/api/health";

/**
 * Tudo num endereço só (http://localhost:5173), com um comando (`pnpm dev`):
 * - a plataforma (este servidor);
 * - a demo do SDK em /demo/ (segundo Vite em modo middleware, no mesmo processo);
 * - o servidor local em Rust (/api), iniciado aqui se ainda não estiver de pé.
 * `CITYVIEW_NO_API=1` desliga o início automático da API.
 */
export function devHub(): Plugin {
  let demo: ViteDevServer | undefined;
  let api: ChildProcess | undefined;

  const stopApi = () => {
    if (!api?.pid || api.exitCode !== null) return;
    // No Windows, matar só o cargo pode deixar o binário filho vivo.
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(api.pid), "/T", "/F"], { stdio: "ignore" });
    else api.kill();
  };

  return {
    name: "cityview-dev-hub",
    apply: "serve",
    async configureServer(server) {
      const log = (msg: string) => server.config.logger.info(msg, { timestamp: true });

      demo = await createServer({
        configFile: false,
        root: DEMO_ROOT,
        base: "/demo/",
        logLevel: "warn",
        build: { target: "es2022" },
        // HMR da demo numa porta interna, para não disputar o WebSocket da plataforma.
        server: { middlewareMode: true, hmr: { port: 24679 } },
      });
      server.middlewares.use((req, res, next) => {
        if (req.url === "/demo") {
          res.statusCode = 302;
          res.setHeader("Location", "/demo/");
          return res.end();
        }
        if (req.url?.startsWith("/demo/")) return demo!.middlewares(req, res, next);
        next();
      });

      if (process.env.CITYVIEW_NO_API) return;
      const running = await fetch(API_HEALTH).then((r) => r.ok, () => false);
      if (running) return log("[api] servidor local já está rodando em :8787");
      log("[api] iniciando o servidor local (cargo run --release -p cityview-api)…");
      api = spawn("cargo", ["run", "--release", "-p", "cityview-api"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
      const relay = (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) log(`[api] ${line}`);
      };
      api.stdout?.on("data", relay);
      api.stderr?.on("data", relay);
      api.on("error", (err) => log(`[api] não deu para iniciar (${err.message}). A plataforma funciona sem ele; rode \`pnpm api\` à parte.`));
      api.on("exit", (code) => code && log(`[api] encerrou (código ${code}). No Windows, rode cargo pelo PowerShell.`));
      server.httpServer?.on("close", stopApi);
      process.once("exit", stopApi);
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => (stopApi(), process.exit()));
    },
    async closeBundle() {
      await demo?.close();
    },
  };
}
