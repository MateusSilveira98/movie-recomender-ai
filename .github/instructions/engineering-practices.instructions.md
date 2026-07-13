---
applyTo: "**/*.{ts,tsx,js,jsx}"
---

# Engineering Practices

These rules apply to all TypeScript/JavaScript code in the project.

## SOLID

Use SOLID as a design criterion, not as an excuse to create premature abstractions.

- Single Responsibility: each file, function, component, or service must have one clear reason to change.
- Open/Closed: prefer composition and configurable data over scattered conditionals when a variation is likely to grow.
- Liskov Substitution: derived types or alternative implementations must preserve the contract expected by the consumer.
- Interface Segregation: expose small, specific interfaces. Do not force consumers to depend on fields or callbacks they do not use.
- Dependency Inversion: high-level rules must not depend directly on storage, API, framework, or library details when that makes testing or replacement harder.

## DRY

Avoid duplication without turning coincidence into abstraction.

- Remove duplication when two code paths express the same business rule.
- Accept small duplication when the reasons to change are different.
- Do not create helpers for one-time use.
- Do not create barrels/re-exports only to shorten imports if that hides the real domain of the contract.
- When extracting code, name it after the rule, not the implementation.

## Object Calisthenics

Apply these as readability and design guidelines.

- Keep functions small and focused on one main level of abstraction.
- Prefer early returns over unnecessary `else` blocks.
- Avoid deep indentation; extract functions when reading requires tracking too many nested blocks.
- Do not use obscure abbreviations in names.
- Avoid loose primitives when recurring domain meaning exists. Create a `type`, `model`, or named object.
- Collections with their own rules must have dedicated manipulation functions instead of duplicated logic in consumers.
- Limit direct access to mutable state. Prefer immutable data and pure functions when possible.
- Do not pass large objects to functions that use only a few fields. Segregate the contract.

## Functions and Files

- A file must represent one main concept.
- Each entity, type, const, service, hook, or component must have a name and suffix consistent with its role.
- Avoid functions with too many parameters; prefer a named object when there are more than three related arguments.
- Avoid boolean flags that completely change a function's behavior. Split them into explicitly named functions.
- Comments must explain decisions or non-obvious context, not narrate the code.

## Security and Robustness

- Validate inputs at boundaries: user input, storage, APIs, environment, and external payloads.
- Do not hardcode secrets, tokens, or sensitive data.
- Do not expose internal details in user-facing error messages.
- Handle invalid states explicitly: null return, fallback, controlled error, or corrupted data removal.

## Testability

- Business rules must be isolatable from UI and external effects.
- Prefer pure functions for scoring, filtering, mapping, validation, and normalization.
- Side effects must stay at the edges: services, hooks, or adapters.
