import { defineConfig } from 'vitest/config';

/* Every gateway test runs twice: on the in-memory store and on the PostgreSQL store (PGlite, in process). */
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'memory', env: { GATEWAY_TEST_STORE: 'memory' } } },
      { extends: true, test: { name: 'postgres', env: { GATEWAY_TEST_STORE: 'postgres' } } },
    ],
  },
});
