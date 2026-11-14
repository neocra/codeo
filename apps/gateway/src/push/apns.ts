import { connect, type ClientHttp2Session } from 'node:http2';
import type { KeyObject } from 'node:crypto';
import type { PushTokenRecord } from '../store';
import { signJwt } from './jwt';
import type { HttpResponse, PushMessage, PushResult, PushSender } from './types';

export const APNS_HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' } as const;

export interface ApnsRequest {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}
export type ApnsTransport = (req: ApnsRequest) => Promise<HttpResponse>;

export interface ApnsOptions {
  /** The .p8 signing key (ES256) from the Apple developer account. */
  key: KeyObject;
  keyId: string;
  teamId: string;
  /** The app's bundle id (`com.codeo.remote`). */
  topic: string;
  now?: () => number;
  /** Defaults to one HTTP/2 connection per APNs host. */
  transport?: ApnsTransport;
}

/* Apple refuses provider tokens older than an hour and throttles ones renewed more often than every 20 minutes. */
const TOKEN_LIFETIME_MS = 50 * 60_000;

/** Reasons for which Apple says the token itself is dead (https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns). */
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

/** HTTP/2 transport: APNs only speaks HTTP/2, and wants long-lived connections. */
export function createHttp2Transport(): ApnsTransport & { close(): Promise<void> } {
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (origin: string): ClientHttp2Session => {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(origin);
    session.on('error', () => sessions.delete(origin));
    session.on('close', () => sessions.delete(origin));
    session.unref();
    sessions.set(origin, session);
    return session;
  };
  const transport = (req: ApnsRequest) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const stream = sessionFor(req.origin).request({ ':method': 'POST', ':path': req.path, ...req.headers });
      stream.setTimeout(15_000, () => stream.close());
      let status = 0;
      const chunks: Buffer[] = [];
      stream.on('response', (headers) => {
        status = Number(headers[':status'] ?? 0);
      });
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
      stream.end(req.body);
    });
  return Object.assign(transport, {
    async close() {
      for (const s of sessions.values()) s.close();
      sessions.clear();
    },
  });
}

export function createApnsSender(opts: ApnsOptions): PushSender {
  const now = opts.now ?? Date.now;
  const owned = opts.transport ? null : createHttp2Transport();
  const transport: ApnsTransport = opts.transport ?? (owned as ApnsTransport);
  let cached: { jwt: string; issuedAt: number } | null = null;

  const providerToken = (): string => {
    const t = now();
    if (!cached || t - cached.issuedAt >= TOKEN_LIFETIME_MS) {
      cached = { jwt: signJwt('ES256', { kid: opts.keyId }, { iss: opts.teamId, iat: Math.floor(t / 1000) }, opts.key), issuedAt: t };
    }
    return cached.jwt;
  };

  return {
    provider: 'apns',
    async send(target: PushTokenRecord, message: PushMessage): Promise<PushResult> {
      const payload = {
        aps: { alert: { title: message.title, body: message.body }, sound: 'default', 'thread-id': message.runtimeId },
        codeo: { type: message.kind, runtimeId: message.runtimeId, approvalId: message.approvalId },
      };
      let res: HttpResponse;
      try {
        res = await transport({
          origin: APNS_HOSTS[target.environment],
          path: `/3/device/${target.token}`,
          headers: {
            authorization: `bearer ${providerToken()}`,
            'apns-topic': opts.topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-expiration': String(Math.max(0, Math.floor(message.expiresAt / 1000))),
            'apns-collapse-id': message.approvalId.slice(0, 64),
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        return { ok: false, invalidToken: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (res.status === 200) return { ok: true };
      let reason = `status ${res.status}`;
      try {
        const parsed = JSON.parse(res.body) as { reason?: unknown };
        if (typeof parsed.reason === 'string') reason = parsed.reason;
      } catch {
        /* no JSON body */
      }
      /* A rejected provider token is ours to fix (key, team, clock): drop the cached one, keep the device token. */
      if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') cached = null;
      return { ok: false, invalidToken: res.status === 410 || DEAD_TOKEN_REASONS.has(reason), reason };
    },
    async close() {
      await owned?.close();
    },
  };
}
