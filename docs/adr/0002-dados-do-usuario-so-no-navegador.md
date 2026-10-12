# ADR 0002 — Dados do usuário são processados só no navegador

- Data: 2026-10-12
- Estado: aceita

## Contexto

O produto visualiza dados públicos e dados do próprio usuário (planilhas, GeoJSON, Parquet de lojas,
clientes, ativos…). Guardar esses dados num servidor traz responsabilidade (LGPD, vazamento, backup,
contas, cotas) e custo, e obriga a ter contas de usuário antes de qualquer coisa.

## Decisão

Arquivos do usuário **nunca saem do computador dele**: leitura, geocodificação por coordenadas, agregação
e tiles acontecem no navegador (Web Workers), e o resultado fica no armazenamento do próprio navegador
(IndexedDB/OPFS). O servidor em produção só entrega o site e os dados públicos (estático).

- `deploy/install.sh` não instala a API por padrão (`--with-api` continua existindo para uso interno/local).
- Sem `/api`, o site esconde "enviar ao servidor" (detecta pelo `/api/health`).
- Compartilhar por link leva só camadas públicas e filtros; camadas do usuário ficam de fora (já era assim).

## Consequências

- Hospedagem barata e simples: qualquer host estático + PMTiles com Range (VM pequena, ou Pages + R2).
- Privacidade é argumento de produto: "seus dados não saem do seu computador".
- **Lacuna a fechar**: hoje arquivos acima de ~20 MB dependem do servidor (tiler em Rust). Para manter a
  promessa de milhões de registros, o tiler precisa rodar no navegador (Rust → WASM num worker, gerando
  PMTiles no OPFS). Até lá, arquivos grandes entram por amostra.
- O dado vive num navegador só: trocar de máquina exige importar de novo (exportar/importar projeto é um
  próximo passo natural).
- `services/api` continua útil em dev e para gerar datasets de exemplo/públicos.
