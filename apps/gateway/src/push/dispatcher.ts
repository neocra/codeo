import type { RuntimeEvent } from '@codeo/contracts';
import { translate } from '@codeo/i18n';
import type { Logger } from '@codeo/shared-utils';
import type { Auditor } from '../audit';
import type { Clock } from '../clock';
import { createRateLimiter } from '../rate-limit';
import type { GatewayStore, PushProvider } from '../store';
import type { PushMessage, PushSender } from './types';

export interface PushDispatcherOptions {
  store: GatewayStore;
  senders: Partial<Record<PushProvider, PushSender>>;
  clock: Clock;
  audit: Auditor;
  log: Logger;
  /** Pushes per runtime per minute (default 30): a runaway runtime cannot flood its phones. */
  maxPerMinute?: number;
}

export interface PushDispatcher {
  /** Providers this gateway can deliver through (its credentials are configured). */
  readonly enabled: readonly PushProvider[];
  /** Called by the relay for every event a runtime streams. Never throws, never blocks the relay. */
  onRuntimeEvent(runtimeId: string, event: RuntimeEvent): void;
  /** Resolves once every push started so far has been handled (tests, shutdown). */
  idle(): Promise<void>;
  close(): Promise<void>;
}

const SEEN_PER_RUNTIME = 500;

/**
 * Sends one push per pending approval to every phone of the runtime that registered a token and may decide
 * approvals. Phones that are connected receive it too: whether the app is in front is only known to the
 * phone, which hides the banner when it is (the event already reached its screen).
 */
export function createPushDispatcher(opts: PushDispatcherOptions): PushDispatcher {
  const { store, senders, clock, audit, log } = opts;
  const limiter = createRateLimiter({ max: opts.maxPerMinute ?? 30, windowMs: 60_000, clock });
  /* Approvals already pushed, per runtime: a relay reconnect replays events the gateway already relayed. */
  const seen = new Map<string, Set<string>>();
  const inflight = new Set<Promise<void>>();

  const markSeen = (runtimeId: string, approvalId: string): boolean => {
    let set = seen.get(runtimeId);
    if (!set) {
      set = new Set();
      seen.set(runtimeId, set);
    }
    if (set.has(approvalId)) return false;
    set.add(approvalId);
    if (set.size > SEEN_PER_RUNTIME) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    return true;
  };

  async function dispatch(runtimeId: string, approvalId: string, expiresAt: number): Promise<void> {
    const targets = await store.pushTokens.listByRuntime(runtimeId);
    if (targets.length === 0) return;
    const devices = await store.devices.listByRuntime(runtimeId);
    const canDecide = new Set(devices.filter((d) => !d.revoked && d.scopes.includes('approval:decide')).map((d) => d.deviceId));
    for (const target of targets) {
      if (!canDecide.has(target.deviceId)) continue;
      const sender = senders[target.provider];
      const actor = `runtime:${runtimeId}`;
      if (!sender) {
        log.debug('push provider not configured', { provider: target.provider, deviceId: target.deviceId });
        continue;
      }
      if (!limiter.hit(runtimeId).allowed) {
        await audit({ actor, action: 'push.send', target: target.deviceId, ok: false, detail: 'rate limited' });
        continue;
      }
      const message: PushMessage = {
        kind: 'approval',
        runtimeId,
        approvalId,
        title: translate(target.locale, 'push.approval.title'),
        body: translate(target.locale, 'push.approval.body'),
        expiresAt,
      };
      const result = await sender.send(target, message);
      if (result.ok) {
        await audit({ actor, action: 'push.send', target: target.deviceId, ok: true, detail: `provider=${target.provider} approval=${approvalId}` });
        continue;
      }
      await audit({ actor, action: 'push.send', target: target.deviceId, ok: false, detail: `provider=${target.provider} reason=${result.reason}` });
      if (result.invalidToken) {
        await store.pushTokens.delete(target.deviceId);
        log.info('push token dropped', { deviceId: target.deviceId, provider: target.provider, reason: result.reason });
      } else {
        log.warn('push failed', { deviceId: target.deviceId, provider: target.provider, reason: result.reason });
      }
    }
  }

  return {
    enabled: (Object.keys(senders) as PushProvider[]).filter((p) => senders[p] !== undefined),
    onRuntimeEvent(runtimeId, event) {
      if (event.type !== 'ApprovalRequested') return;
      const { approval } = event;
      const expiresAt = Date.parse(approval.expiresAt);
      if (approval.status !== 'pending' || !(expiresAt > clock())) return;
      if (!markSeen(runtimeId, approval.id)) return;
      const job = dispatch(runtimeId, approval.id, expiresAt)
        .catch((err: unknown) => log.warn('push dispatch failed', { runtimeId, err: err instanceof Error ? err.message : String(err) }))
        .finally(() => inflight.delete(job));
      inflight.add(job);
    },
    async idle() {
      while (inflight.size > 0) await Promise.all([...inflight]);
    },
    async close() {
      await this.idle();
      for (const s of Object.values(senders)) await s?.close();
    },
  };
}
