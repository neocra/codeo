import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  /* Workspace packages are bundled; published dependencies (native SDK binaries, libsql, ws) stay external. */
  noExternal: [/^@codeo\//],
  external: ['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk', '@libsql/client', 'drizzle-orm', 'ws', 'zod'],
  onSuccess: async () => {
    /* Migrations ship next to the bundle; `defaultMigrationsFolder()` looks for `./migrations` first. */
    cpSync('../../packages/database/migrations', 'dist/migrations', { recursive: true });
  },
});
