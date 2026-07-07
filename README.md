# movie-recomender-ai

Aplicacao de recomendacao de filmes para pessoas que nao querem perder tempo escolhendo o que assistir em streamings.

## Workspace

Este repositorio usa Nx em formato monorepo:

- `apps/`: aplicacoes deployaveis, como web e api.
- `packages/`: bibliotecas compartilhadas, como database, ml, recommender e shared.
- `data/`: dados locais de desenvolvimento e treino. Os CSVs brutos nao devem ser versionados.
- `models/`: modelos gerados localmente ou por pipeline. Artefatos gerados nao devem ser versionados.

## Comandos

```bash
npm install
npm run projects
npm run graph
npm run affected
```
