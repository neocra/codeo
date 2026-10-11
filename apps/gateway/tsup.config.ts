import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  /* Workspace packages are bundled; published dependencies stay external. */
  noExternal: [/^@codeo\//],
  external: ['fastify', '@fastify/websocket', 'ws', 'zod'],
});
