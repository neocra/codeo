import { newId, redactSecrets, type Logger } from '@codeo/shared-utils';
import type { Clock } from './clock';
import type { AuditStore } from './store';

export interface AuditInput {
  actor: string;
  action: string;
  target?: string | null | undefined;
  ok: boolean;
  /** Free text; passed through secret redaction. Never pass command params or tokens. */
  detail?: string | undefined;
}

export type Auditor = (input: AuditInput) => Promise<void>;

/** Writes audit entries; never throws (a failing audit sink is logged, not propagated). */
export function createAuditor(store: AuditStore, clock: Clock, log: Logger): Auditor {
  return async (input) => {
    const entry = {
      id: newId('aud'),
      at: new Date(clock()).toISOString(),
      actor: input.actor,
      action: input.action,
      target: input.target ?? null,
      ok: input.ok,
      detail: input.detail === undefined ? null : redactSecrets(input.detail),
    };
    try {
      await store.append(entry);
      log.debug('audit', { action: entry.action, actor: entry.actor, target: entry.target, ok: entry.ok });
    } catch (err) {
      log.error('audit write failed', { action: entry.action, err: err instanceof Error ? err.message : String(err) });
    }
  };
}
