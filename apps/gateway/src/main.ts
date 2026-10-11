import { createLogger } from '@codeo/shared-utils';
import { buildApp, GATEWAY_VERSION } from './app';
import { loadConfig } from './config';
import { createMemoryStore } from './store';

const bootLog = createLogger({ scope: 'gateway' });
const config = loadConfig(process.env, { warn: (m) => bootLog.warn(m) });
const log = createLogger({ scope: 'gateway', level: config.logLevel });

/* Phase 1: in-memory store. Everything (registrations, pairings, refresh tokens, audit) is lost on restart. */
const store = createMemoryStore();
const { app } = await buildApp(config, store, { logger: log });

await app.listen({ port: config.port, host: config.host });
log.info('gateway listening', {
  version: GATEWAY_VERSION,
  host: config.host,
  port: config.port,
  tls: config.tls !== null,
  publicUrl: config.publicUrl,
  env: config.env,
});
if (config.env === 'production' && config.tls === null) {
  log.warn('TLS is not terminated by the gateway: make sure a reverse proxy terminates TLS in front of it');
}

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  app
    .close()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      log.error('shutdown failed', { err: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
