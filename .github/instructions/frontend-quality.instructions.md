---
applyTo: "apps/web/src/**/*.{ts,tsx}"
---

# Frontend Quality

Beyond folder structure, all frontend code must follow these quality rules.

## State and Side Effects

- Screen state belongs in hooks or containers, not scattered across presentational components.
- Side effects belong in `data-access`: storage, APIs, timers, listeners, cache, and external integrations.
- Components should receive render-ready data whenever possible.
- Normalize data at the application/feature entry point, not in the middle of the component tree.
- Keep persisted payloads versionable or normalizable when legacy formats are possible.

## UI States

Every screen or flow with external, persisted, or calculated data must consider:

- initial state;
- loading, when applicable;
- empty state;
- recoverable error;
- success;
- legacy or invalid data, when it comes from storage/APIs.

Do not hide invalid state with a silent fallback if it can mask a bug or corrupted data.

## Accessibility

- Buttons must have accessible text or `aria-label` when they are icon-only.
- Inputs must have clear labels.
- Tabs, toggles, and selection groups must reflect the selected state.
- Do not rely on color alone to communicate state.
- Preserve keyboard navigation in interactive components.

## Performance

- Use `useMemo` and `useCallback` only when there is real cost, required identity stability, or relevant repeated rendering.
- Do not run expensive filtering, sorting, or normalization inside dumb components.
- Avoid recreating arrays/objects in props when that causes unnecessary rendering in large lists.
- Keep lists keyed by stable domain identifiers, never by index when order can change.

## Components

- Dumb components do not import `data-access`.
- Smart components do not access storage/APIs directly.
- Containers coordinate flow, but must not accumulate complex domain rules.
- Shared domain rules must go to `shared` or to a feature service/function, depending on the real scope.
- Props must be explicit and small. Do not pass the entire hook state to a component that uses only part of it.

## UX Copy

- Visible text must be specific to the current action or state.
- Avoid technical text about implementation, structure, shortcuts, or architecture inside the UI.
- Error messages must indicate a possible action when recovery exists.
