---
applyTo: "apps/web/src/**/*.{ts,tsx}"
---

# Frontend Structure

Use this structure as the required reference for frontend code in `apps/web/src`.

## `app`

Application bootstrap layer.

- `app.tsx`: composes the application and points to pages/features.
- `providers/`: configures global React providers, theme, routing, and application-level integrations.
- `theme/*.const.ts`: theme tokens and theme configuration. Do not place business rules here.

## `features`

Each feature must be isolated under `features/<feature-name>`.

A feature can contain:

- `pages/`: route/screen entry points. Files use `.page.tsx`.
- `containers/`: screen orchestration. Connects hooks, state, and components. Files use `.container.tsx`.
- `smart-components/`: components with flow decisions, composition, or screen-level business callbacks. Files use `.smartc.tsx`.
- `dumb-components/`: purely presentational components. They receive data through props and emit simple events. Files use `.dumbc.tsx`.
- `data-access/`: data access, flow hooks, adapters, services, and contracts related to persistence, APIs, localStorage, or side effects.
- `entities/`: feature-owned models, types, and constants.
- `index.ts`: public entry point for the feature.

## Components

Each component must have its own folder.

Example:

- `preferences-step/preferences-step.smartc.tsx`
- `preferences-step/preferences-step.interface.ts`

Rules:

- Props live beside the component in `*.interface.ts`.
- Do not centralize component props in `entities`.
- Do not place more than one public interface in the same file when they represent different concepts.
- `dumb` components must not access storage, APIs, flow hooks, or data-access services.
- `smart` components can compose callbacks and received state, but side effects must live in `data-access` hooks/services.

## `entities`

Use `entities` only for feature-owned contracts.

Required organization:

- `entities/models/*.model.ts`
- `entities/types/*.type.ts`
- `entities/consts/*.const.ts`

Rules:

- Each model, type, or const must have its own file when it represents an independent concept.
- Do not create local files only to re-export types or constants from `shared`.
- If the contract already exists in `@movie-recomender-ai/shared`, import directly from it.
- Local persistence contracts or serialized UI state are not domain entities. Example: `StoredSession` and `RecommendationRound` belong in `data-access/services/ui-services/movie-session.ui.service.ts`.

## `data-access`

Layer for accessing, transforming, and persisting data used by the feature.

Use it for:

- flow hooks, such as `use-recommendation-flow.hook.ts`;
- UI services, such as `*.ui.service.ts`;
- adapters, when transforming between an external contract and a view model;
- contracts related to storage, cache, APIs, or side effects.

Rules:

- LocalStorage must live in a `data-access` service, never in a component.
- Normalization/migration of persisted payloads must stay close to the service that reads the payload.
- `data-access` hooks can coordinate state and services, but must not render UI.

## `shared` in the frontend

The frontend can consume global contracts from `@movie-recomender-ai/shared`, but must not hide them behind local wrappers.

Use direct imports, for example:

- `@movie-recomender-ai/shared/entities/models/movie.model`
- `@movie-recomender-ai/shared/entities/types/runtime-preference.type`
- `@movie-recomender-ai/shared/entities/consts/genre-options.const`
- `@movie-recomender-ai/shared/mocks/movie`

If a type belongs to the global domain, it belongs in `shared`. If it belongs only to a feature/screen, it stays inside that feature.
