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
npm run check
npm run build
npm run dev:web
npm run dev:api
npm run graph
npm run affected
```

## Hello world local

- Web: `http://127.0.0.1:5173`
- API healthcheck: `http://127.0.0.1:3333/health`
- API recomendacoes demo: `http://127.0.0.1:3333/recommendations/demo`
