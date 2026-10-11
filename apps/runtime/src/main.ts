import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '@codeo/shared-utils';
import { createRuntime } from './runtime';
import { startServer } from './server/ws-server';
import { RUNTIME_VERSION } from './version';

/**
 * Standalone runtime entry. Started by Codeo Desktop (as a child process) or by hand:
 *   CODEO_DATA_DIR=~/.codeo codeo-runtime
 * Prints one JSON line `CODEO_RUNTIME_READY {...}` on stdout once it accepts connections.
 */
async function main() {
  const dataDir = process.env['CODEO_DATA_DIR'] ?? path.join(os.homedir(), '.codeo');
  mkdirSync(dataDir, { recursive: true });
  const logger = createLogger({ scope: 'runtime' });
  const token = process.env['CODEO_RUNTIME_TOKEN'] ?? randomBytes(32).toString('hex');
  const port = Number(process.env['CODEO_RUNTIME_PORT'] ?? 0);
  const host = process.env['CODEO_RUNTIME_HOST'] ?? '127.0.0.1';

  const runtime = await createRuntime({ dataDir, logger });
  const server = await startServer({ runtime, token, host, port, logger: logger.child('ws') });
  runtime.bus.publish('RuntimeReady', { version: RUNTIME_VERSION });

  /* Discovery file for local clients (CLI, a desktop started after the runtime). Mode 0600. */
  const discovery = { url: `ws://${server.host}:${server.port}`, token, pid: process.pid, version: RUNTIME_VERSION, startedAt: runtime.info.startedAt };
  writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify(discovery, null, 2), { mode: 0o600 });
  process.stdout.write(`CODEO_RUNTIME_READY ${JSON.stringify({ url: discovery.url, version: RUNTIME_VERSION })}\n`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    await server.close();
    await runtime.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('disconnect', () => void stop('disconnect'));
  /* When spawned by the desktop, a closed stdin means the parent is gone. */
  if (process.env['CODEO_RUNTIME_PARENT'] === 'desktop') process.stdin.on('end', () => void stop('stdin-end')).resume();
}

main().catch((err) => {
  process.stderr.write(`runtime failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
