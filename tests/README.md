# Tests

- Unit tests live next to each package (`packages/*/test`, `apps/*/test`) and run with `pnpm test`.
- `apps/runtime/test/runtime.test.ts` is the integration test of the whole runtime over the real
  WebSocket protocol (fake provider, real SQLite, real git repository).
- `tests/e2e` is reserved for Playwright Electron scenarios (phase 9).
