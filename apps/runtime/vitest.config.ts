import { defineConfig } from 'vitest/config';

/* git worktree operations are slow on the Windows CI runners. */
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 120_000 } });
