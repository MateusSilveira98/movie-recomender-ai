---
applyTo: "apps/web/src/**/*.spec.{ts,tsx}"
---

# Frontend Testing

Use Vitest, Testing Library, and strict HTTP mocks for frontend behavior tests.

## Naming and structure

- Write all `describe` and `it` names in English.
- Use a top-level `describe` for the unit under test and nested `describe` blocks for each user-visible state or business situation.
- Name tests after observable behavior, not implementation details.
- Keep the application copy in the language used by the UI; only test descriptions are required to be in English.

## Scope and isolation

- Test visible user journeys and API contracts. Do not assert component internals, hook state, or implementation-specific markup.
- Mock HTTP at the `fetch` boundary. Every expected request must be explicitly declared; unexpected requests must fail the test.
- Reset global mocks and module state after each test whenever the test stubs globals or imports stateful modules.
- Keep tests independent: they must not rely on execution order, network access, or persisted browser state from another test.

## Coverage

- Cover the successful journey, empty or initial state, and recoverable error states relevant to the flow.
- Assert request method, URL, relevant payload, credentials, and CSRF headers for state-changing API calls.
- Prefer accessible queries (`getByRole`, `findByRole`, labels, and visible text) and use `userEvent` for interactions.
