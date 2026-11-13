import type { Logger } from '@codeo/shared-utils';
import type { Clock } from './clock';
import type { GatewayStore } from './store';

export interface MaintenanceOptions {
  store: GatewayStore;
  clock: Clock;
  log: Logger;
  /** Audit entries older than this are deleted. */
  auditRetentionDays: number;
}

/**
 * Deletes what the gateway no longer needs: used or expired pairing codes, expired refresh tokens
 * (rotated ones are kept until expiry for reuse detection) and audit entries past retention.
 * Each part runs on its own so one failure does not keep the others from running.
 */
export async function runMaintenance(opts: MaintenanceOptions): Promise<void> {
  const now = opts.clock();
  const parts: [string, () => Promise<void>][] = [
    ['pairingCodes', () => opts.store.pairingCodes.prune(now)],
    ['refreshTokens', () => opts.store.refreshTokens.prune(now)],
    ['audit', () => opts.store.audit.prune(new Date(now - opts.auditRetentionDays * 86_400_000).toISOString())],
  ];
  for (const [name, run] of parts) {
    try {
      await run();
    } catch (err) {
      opts.log.warn('maintenance step failed', { step: name, err: err instanceof Error ? err.message : String(err) });
    }
  }
}
