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

Outros comandos: `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Estrutura

```
apps/web/          app React (Vite)
packages/engine/   API do mapa (CityMap) sobre MapLibre + PMTiles
data/              scripts de dados; saída em data/out (fora do git)
docs/              roadmap e arquitetura
.claude/agents/    agentes especialistas
```
