---
applyTo: "{apps/bff,packages/database,packages/ml,packages/recommender,packages/observability}/src/**/*.spec.ts"
---

# Backend Testing

Test observable behavior and business outcomes. A passing suite must give confidence that a client receives the correct response or that a business rule produces the correct decision.

## Naming and organization

- Write every `describe` and `it` name in English.
- Group scenarios by business rule or externally visible state: success, empty state, invalid input, authorization, dependency failure, and recovery when applicable.
- Keep each test focused on one observable result. Split a scenario that verifies unrelated rules.
- Keep API copy assertions in the language used by the API; only test descriptions are English.
- Place HTTP integration specs beside the bounded context they exercise. Put shared server/database setup in `apps/bff/src/test-support/`.

## Test layers

- **Domain/application tests:** run real ranking, validation, policy, and state-transition rules with business fixtures.
- **HTTP integration tests:** run the real Express routes, validation, controllers, and application composition. Assert status, response payload, headers, and side effects that are business outcomes.
- **Adapter integration tests:** run separately against controlled, non-production Turso/R2/QStash environments. Assert the real provider contract, including expected failures.
- **Smoke tests:** after deploy, make a minimal non-sensitive request to the published service to prove it started and is reachable. They do not replace integration tests.

## Fakes and external dependencies

- Use fakes only at external ports such as storage, queues, and telemetry. A fake must honor the same port contract as the real adapter.
- Never mock the rule or use case under test.
- Do not use production credentials or production data in tests.
- Explicitly cover a dependency failure whenever the application has a recovery behavior.

## Business fixtures and assertions

- Name fixtures after their business role, not implementation details.
- Prefer assertions on recommendations, eligibility, ordering, status codes, payload fields, persisted business state, and error contracts.
- Do not assert private method calls, internal mutable state, logger calls, or SQL shape unless the persistence result itself is the business contract.
- For recommendation flows, cover at least: valid ranking, excluded/ineligible item, feedback changing the next result, empty catalog, and model/provider fallback.
