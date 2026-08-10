---
applyTo: "{apps/bff,packages/database,packages/ml,packages/recommender}/src/**/*.ts"
---

# Backend DDD Structure

Use Domain-Driven Design (DDD) as the required structure for backend applications and backend libraries.

## Layers and Dependency Direction

Organize code by bounded context and keep dependencies pointing inward:

- `domain/`: business concepts, entities, value objects, policies, domain services, and ports. This layer must not import Express, LibSQL, S3, TensorFlow, Node HTTP APIs, or other infrastructure/framework details.
- `application/`: use cases and orchestration of domain rules. It depends only on `domain/` contracts and receives infrastructure through ports.
- `infrastructure/`: adapters for databases, queues, storage, HTTP clients, ML runtimes, and framework integrations. It implements ports defined by the domain or application layer.
- `controllers/`, `routes/`, or other delivery code: translate transport input/output and delegate to application services. They must not contain business rules or direct persistence queries.

Allowed direction: delivery/infrastructure -> application -> domain. Do not reverse it.

## Bounded Contexts

- Group code by business capability, not only by technical type. Examples: `sessions`, `movies`, `dataset-imports`, and `model-artifacts`.
- Keep context-specific models and rules inside their context. Promote a contract to `@pkg/shared` only when it is genuinely used across independent contexts or by the frontend.
- Avoid importing another context's repository or infrastructure adapter. Expose an application service or a narrow port when collaboration is necessary.

## Ports and Adapters

- Define a port before coupling application/domain code to a database, queue, storage provider, or ML implementation.
- Give ports domain-oriented names such as `ModelArtifactStorage` or `MovieCatalogRepository`; do not expose vendor terminology in domain contracts.
- Create adapters in `infrastructure/` and compose them at the application bootstrap (`main.ts` or equivalent).
- Validate and normalize external input at adapters/controllers. Keep internal domain operations typed and intentional.

## Models and Business Rules

- Put business invariants, ranking rules, validation policies, and state transitions in the domain or application layer, never in routes, controllers, or SQL mappers.
- Keep persistence records, request DTOs, and response DTOs separate from domain models when their shape or lifecycle differs.
- Preserve the BFF as an orchestrator: it coordinates use cases, session security, and transport, while reusable recommendation rules remain in `@pkg/recommender`.
- Prefer small, explicit use cases over generic services that accumulate unrelated behavior.

## Testing

- Test domain rules without database, HTTP, storage, queue, or TensorFlow dependencies.
- Test application services with fake ports when practical.
- Test infrastructure adapters and controllers at their integration boundary, including invalid external input and failure mapping.
- Do not move business-rule coverage solely to end-to-end tests.

## Pragmatism

- Apply DDD where there is a business concept or integration boundary. Do not create empty layers, factories, entities, or interfaces for trivial one-use code.
- Preserve existing contracts and behavior unless the requested change explicitly requires a migration.
