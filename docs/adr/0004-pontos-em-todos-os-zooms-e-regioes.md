# ADR 0004 — Bolinhas em todos os zooms; regiões de verdade como vista agrupada

**Data:** 2026-10-13 · **Estado:** aceito

## Contexto

Até aqui o mapa mostrava hexágonos H3 em qualquer zoom abaixo do 14 e só depois as bolinhas. Para quem sobe
uma planilha de algumas centenas de registros, isso escondia os dados ("só aparecem menos de 10") e o hexágono
não diz nada a quem olha. O pedido: ver as bolinhas sempre e, como vista agrupada, regiões que as pessoas
reconhecem (estado, município) com o número de registros.

## Decisão

1. **Pontos do zoom 0 ao 14** no PMTiles, no mesmo tile dos hexágonos (o PMTiles guarda um tile por z/x/y).
   Abaixo do 14, tile com mais de 5 mil pontos fica com um ponto por célula de uma grade 256×256, só com a
   categoria; a rarefação é feita de baixo para cima. Planilhas pequenas vão inteiras, com as colunas.
   Metadado `pointsMinZoom`. Arquivos antigos (sem ele) continuam com hexágonos no zoom afastado.
2. **Contagem por região no tiler** (`crates/tiler/src/regions.rs`): cada ponto cai num polígono de uma malha
   GeoJSON (IBGE: estados e municípios do catálogo), com contagem por categoria, gravada nos metadados
   (`regions`: nível → código → [total, c0…]). Uma implementação para os dois caminhos: navegador (WASM, o
   worker baixa as malhas) e linha de comando (`regions` no spec).
3. **No mapa**, a vista "Regiões" desenha a malha (estado até o zoom 5,5, município até o 12) preenchida pela
   densidade e com o número no centro; as bolinhas entram a partir do zoom 11. Hexágonos ficam só para as
   colunas 3D.

## Consequências

- Arquivos maiores nas bases enormes (Estabelecimentos Brasil: 630 MB → 1,8 GB), pelos pontos com colunas nos
  zooms 10–13. Se pesar no R2, enxugar esses zooms nas bases grandes (só categoria e nome).
- Clique num ponto rarefeito não tem as colunas: o cartão oferece "Aproximar aqui".
- Bairros ficam para depois (malha aberta só para parte dos municípios); entram como mais um nível da malha.
- O filtro por categoria vale também nas regiões (a contagem por categoria está nos metadados); o filtro por
  valor de coluna não (as regiões só têm a contagem por categoria).
