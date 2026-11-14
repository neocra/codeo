import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { PushTokenRecord } from '../store';
import { signJwt } from './jwt';
import type { HttpResponse, PushMessage, PushResult, PushSender } from './types';

export type FcmTransport = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<HttpResponse>;

/** The fields of a Google service-account JSON key the sender uses. */
export const ServiceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(3),
  private_key: z.string().min(32),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
});

export interface FcmOptions {
  projectId: string;
  clientEmail: string;
  key: KeyObject;
  tokenUri: string;
  now?: () => number;
  transport?: FcmTransport;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAuthTokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });

const fetchTransport: FcmTransport = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.text() };
};

/** FCM HTTP v1 (`projects/<id>/messages:send`) with an OAuth token minted from the service account. */
export function createFcmSender(opts: FcmOptions): PushSender {
  const now = opts.now ?? Date.now;
  const transport = opts.transport ?? fetchTransport;
  let access: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    const t = now();
    if (access && access.expiresAt - 60_000 > t) return access.token;
    const iat = Math.floor(t / 1000);
    const assertion = signJwt('RS256', {}, { iss: opts.clientEmail, scope: SCOPE, aud: opts.tokenUri, iat, exp: iat + 3600 }, opts.key);
    const res = await transport(opts.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (res.status !== 200) throw new Error(`oauth token refused (status ${res.status})`);
    const parsed = OAuthTokenSchema.safeParse(JSON.parse(res.body));
    if (!parsed.success) throw new Error('unexpected oauth token response');
    access = { token: parsed.data.access_token, expiresAt: t + parsed.data.expires_in * 1000 };
    return access.token;
  }

  return {
    provider: 'fcm',
    async send(target: PushTokenRecord, message: PushMessage): Promise<PushResult> {
      const ttlSeconds = Math.max(0, Math.floor((message.expiresAt - now()) / 1000));
      const body = {
        message: {
          token: target.token,
          notification: { title: message.title, body: message.body },
          data: { type: message.kind, runtimeId: message.runtimeId, approvalId: message.approvalId },
          /* `approvals` is the channel the app creates (apps/mobile/lib/push.ts). */
          android: { priority: 'HIGH', ttl: `${ttlSeconds}s`, collapse_key: message.approvalId, notification: { channel_id: 'approvals' } },
        },
      };
      let res: HttpResponse;
      try {
        res = await transport(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(opts.projectId)}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return { ok: false, invalidToken: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (res.status === 200) return { ok: true };
      if (res.status === 401) access = null;
      let reason = `status ${res.status}`;
      try {
        const parsed = JSON.parse(res.body) as { error?: { status?: unknown; details?: { errorCode?: unknown }[] } };
        const code = parsed.error?.details?.find((d) => typeof d.errorCode === 'string')?.errorCode ?? parsed.error?.status;
        if (typeof code === 'string') reason = code;
      } catch {
        /* no JSON body */
      }
      /* UNREGISTERED (404): the app was uninstalled or the token rotated; INVALID_ARGUMENT on a send is a malformed token. */
      return { ok: false, invalidToken: res.status === 404 || reason === 'UNREGISTERED' || reason === 'INVALID_ARGUMENT', reason };
    },
    async close() {},
  };
}
