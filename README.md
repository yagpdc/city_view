# city_view

Plataforma web de mapas 2D/3D: visualizar, desenhar, medir e analisar dados geoespaciais — local-first e baseada em dados abertos.

- [Roadmap](docs/ROADMAP.md)
- [Arquitetura e stack](docs/ARCHITECTURE.md)

## Rodando localmente

Requisitos: Node 22+, pnpm, Python 3.11+.

```bash
pnpm install
pnpm data:sp   # baixa/gera os dados de São Paulo em data/out (~140 MB, uma vez só)
pnpm dev       # http://localhost:5173
```

### Prova de conceito: 30M de empresas embutidas

Requer Rust (toolchain MSVC no Windows, com o Windows SDK instalado). No Windows, rode o `cargo` pelo PowerShell: o `link.exe` do Git Bash esconde o linker da Microsoft.

```bash
python data/build_sp.py --brasil   # mapa base do Brasil (~760 MB)
pnpm synth                         # 30M de empresas sintéticas → data/out/empresas.parquet
pnpm tiles                         # Parquet → data/out/empresas.pmtiles (~40 s)
pnpm datapacks                     # camadas do catálogo (IBGE, NASA FIRMS) → data/out/datapacks
pnpm dev                           # plataforma: http://localhost:5173
pnpm demo                          # site de cliente com o SDK: http://localhost:5174
```

Outros comandos: `pnpm typecheck`, `pnpm test`, `pnpm build`, `cargo test`.

## Estrutura

```
apps/web/          app React (Vite)
packages/engine/   API interna do mapa (CityMap) sobre MapLibre + PMTiles
packages/sdk/      SDK público que o cliente instala (CityView.map)
apps/embed-demo/   site de "empresa cliente" usando o SDK
crates/tiler/      motor de dados: Parquet → H3 + pontos → PMTiles (Rust)
crates/synth/      gerador de datasets sintéticos (Rust)
datapacks/         catálogo: manifestos versionados + receitas de download (build.py)
data/              scripts de dados; saída em data/out (fora do git)
docs/              roadmap e arquitetura
.claude/agents/    agentes especialistas
```
