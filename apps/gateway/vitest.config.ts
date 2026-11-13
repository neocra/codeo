import { defineConfig } from 'vitest/config';

/* Every gateway test runs twice: on the in-memory store and on the PostgreSQL store (PGlite, in process). */
export default defineConfig({
  test: {
    /* PGlite boots a WASM PostgreSQL per store: a few seconds on a busy CI runner. */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      { extends: true, test: { name: 'memory', env: { GATEWAY_TEST_STORE: 'memory' } } },
      { extends: true, test: { name: 'postgres', env: { GATEWAY_TEST_STORE: 'postgres' } } },
    ],
  },
});
