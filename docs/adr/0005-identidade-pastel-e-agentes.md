# ADR 0005 — Identidade arredondada e pastel, com mundos de cor e personagens-agente

**Data:** 2026-10-15 · **Estado:** aceito

## Contexto

O app tinha cara de SaaS genérico: cartões brancos sobre cinza, botão azul, nenhuma marca. Uma primeira
tentativa (paleta "Aurora", vidro, halos) não agradou. A direção veio das referências que o usuário escolheu:
Clay (ilustração tátil, cada área com seu mundo de cor, botão escuro), os agentes "dots" da OpenAI e o Grok
Bot (personagens arredondados e pastel, interface sóbria). O mapa vai virar agêntico em breve, e o visual deve
já conversar com essa linguagem. Prancha aprovada: https://claude.ai/artifact/TmPnN6hJEeiYaaFp4MdFCN

## Decisão

1. **Base quente e minimalista:** chão creme `#F6F5F1`, superfícies brancas, tinta `#1D1E24` no texto e no
   botão principal (pílula). Fim do "botão azul". Destaque (barras, progresso, escolhido) em lilás `#8B7CF6`.
2. **Mundos de cor por área** (fundo / personagem / tinta): Camadas lilás, Adicionar menta, Detalhes céu,
   Widgets pêssego, Agentes limão, Ajustes rosa. A gaveta toma o fundo do seu mundo; o botão redondo ativo,
   a cor de destaque dele. O que abre a partir de uma gaveta herda o mundo dela. **Nunca no mapa**: lá a
   cor é dos dados (paleta de categorias inalterada).
3. **Formas que lembram o mapa:** cantos generosos (10–26 px, pílulas), e uma turma de personagens-agente
   (`components/Agents.tsx`): Pino (alfinete, explorador), Hexa (hexágono, analista), Bolha (arrumadeira),
   Quadra (quadra com bandeirinha, cartógrafa), Lume (sol, vigia). Rosto só em agentes, vazios,
   carregamentos e na marca; dado, número e mapa nunca ganham carinha.
4. **Tipografia:** Bricolage Grotesque nos títulos, Figtree na interface, DM Mono nos números. Todas OFL,
   empacotadas (`@fontsource`), sem depender do Google Fonts.
5. **Mapa base "Para dados" claro na paleta:** chão creme, ruas brancas, água e verde em pastel bem leve
   (`BRAND_DATA_LIGHT` em `packages/engine/src/style.ts`).
6. **Movimento na medida:** gavetas e widgets abrem com um quique leve (`--cv-spring`), desligado com
   `prefers-reduced-motion`.

## Consequências

- Tokens mantêm os nomes (`--cv-*`); `--cv-action` passou a ser a tinta e `--cv-accent` o lilás de destaque.
  Novos: `--cv-{lilac,mint,peach,sky,lemon,pink}-{bg,fill,ink}`, `--world-*`, `--cv-font-display`.
- O tema escuro ganhou mundos escuros equivalentes, mas foi pouco revisado: ajustar quando voltar a ele.
- Próximo: personagens nos carregamentos e no primeiro uso; ilustrações de maquete (three.js) nos vazios;
  revisar a paleta de categorias para conversar com a marca sem perder o contraste ≥ 3:1.
