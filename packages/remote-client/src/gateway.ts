import { z } from 'zod';

/**
 * Phone side of the Codeo gateway (`apps/gateway`): QR pairing, access-token refresh with rotation, and
 * the device WebSocket URL. Everything that comes back from the network is parsed with zod; credentials
 * only ever travel in request bodies (pairing, refresh) or in `Authorization: Bearer` headers, never in URLs.
 */

/** Hosts that are this machine (or the Android emulator's alias for it): plain HTTP is accepted only there. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'];

export type GatewayErrorCode =
  /** The scanned QR code is not a Codeo pairing code. */
  | 'INVALID_QR'
  /** Not an http(s) URL. */
  | 'INVALID_URL'
  /** Plain HTTP towards a host that is not this machine. */
  | 'INSECURE_GATEWAY'
  /** Network failure, timeout or 5xx: worth retrying. */
  | 'UNREACHABLE'
  /** Unknown, expired, already used or mismatched pairing code. */
  | 'PAIRING_REFUSED'
  | 'RATE_LIMITED'
  /** The refresh token was refused (expired, unknown or reused): the phone must pair again. */
  | 'UNAUTHORIZED'
  /** The desktop revoked this phone. */
  | 'REVOKED'
  /** The gateway answered something this client does not understand. */
  | 'BAD_RESPONSE';

export class GatewayClientError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GatewayClientError';
  }

  /** True when retrying cannot help: the credentials are gone and the phone has to pair again. */
  get fatal(): boolean {
    return this.code === 'UNAUTHORIZED' || this.code === 'REVOKED';
  }
}

/** Keeps the scheme, host, port and path prefix; drops the trailing slash, query and fragment. */
export function normalizeGatewayUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new GatewayClientError('INVALID_URL', 'invalid gateway URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new GatewayClientError('INVALID_URL', 'invalid gateway URL');
  if (u.protocol === 'http:' && !LOOPBACK_HOSTS.includes(u.hostname)) {
    throw new GatewayClientError('INSECURE_GATEWAY', 'the gateway must use HTTPS (HTTP is only accepted for this machine)');
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** `https://gw.example/x` → `wss://gw.example/x/v1/devices/connect`. */
export function deviceConnectUrl(gatewayUrl: string): string {
  const base = normalizeGatewayUrl(gatewayUrl);
  return `${base.replace(/^http/, 'ws')}/v1/devices/connect`;
}

/** What the desktop encodes in the pairing QR code (`apps/gateway/src/pairing.ts`). */
export const PairingQrSchema = z.object({
  v: z.literal(1),
  gateway: z.string().min(1).max(2048),
  code: z.string().regex(/^\d{6}$/),
  runtimeId: z.string().min(3).max(80),
  nonce: z.string().min(8).max(64),
});
export type PairingQr = z.infer<typeof PairingQrSchema>;

/** Parses a scanned QR code; the gateway URL is normalized (and refused when insecure). */
export function parsePairingQr(raw: string): PairingQr {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new GatewayClientError('INVALID_QR', 'not a Codeo pairing code');
  }
  const parsed = PairingQrSchema.safeParse(json);
  if (!parsed.success) throw new GatewayClientError('INVALID_QR', 'not a Codeo pairing code');
  return { ...parsed.data, gateway: normalizeGatewayUrl(parsed.data.gateway) };
}

const IssuedCredentialsSchema = z.object({
  accessToken: z.string().min(16).max(4096),
  accessTokenExpiresAt: z.iso.datetime({ offset: true }),
  refreshToken: z.string().min(16).max(512),
  scopes: z.array(z.string()),
  runtimeId: z.string().min(1),
  deviceId: z.string().min(1),
});

const PairingCompleteResponseSchema = IssuedCredentialsSchema.extend({
  device: z.object({ deviceId: z.string(), name: z.string(), platform: z.enum(['ios', 'android']), pairedAt: z.iso.datetime({ offset: true }) }),
});

const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Everything the phone keeps after pairing. The refresh token is the secret: store it in the keychain. */
export const GatewayCredentialsSchema = z.object({
  gatewayUrl: z.string(),
  runtimeId: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  pairedAt: z.string(),
  scopes: z.array(z.string()),
  accessToken: z.string(),
  /** ISO-8601. */
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
});
export type GatewayCredentials = z.infer<typeof GatewayCredentialsSchema>;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

interface HttpOptions {
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

async function postJson(url: string, body: unknown, opts: HttpOptions): Promise<{ status: number; body: unknown }> {
  const doFetch: FetchLike = opts.fetch ?? ((u, init) => fetch(u, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty or non-JSON body: the status decides */
    }
    return { status: res.status, body: json };
  } catch (err) {
    throw new GatewayClientError('UNREACHABLE', err instanceof Error ? err.message : 'gateway unreachable');
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(body: unknown, fallback: string): string {
  const parsed = ErrorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : fallback;
}

export interface CompletePairingInput extends HttpOptions {
  gatewayUrl: string;
  code: string;
  /** From the QR code; omitted for a code typed by hand. */
  nonce?: string | undefined;
  runtimeId?: string | undefined;
  device: { name: string; platform: 'ios' | 'android' };
}

/** `POST /v1/pairing/complete`: trades a pairing code for this phone's first credentials. */
export async function completePairing(input: CompletePairingInput): Promise<GatewayCredentials> {
  const gatewayUrl = normalizeGatewayUrl(input.gatewayUrl);
  if (!/^\d{6}$/.test(input.code)) throw new GatewayClientError('PAIRING_REFUSED', 'pairing code must be 6 digits');
  const res = await postJson(
    `${gatewayUrl}/v1/pairing/complete`,
    {
      code: input.code,
      ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
      ...(input.runtimeId !== undefined ? { runtimeId: input.runtimeId } : {}),
      device: { name: input.device.name.slice(0, 120) || 'Phone', platform: input.device.platform },
    },
    input,
  );
  if (res.status === 429) throw new GatewayClientError('RATE_LIMITED', errorMessage(res.body, 'too many attempts'), 429);
  if (res.status === 404 || res.status === 400) throw new GatewayClientError('PAIRING_REFUSED', errorMessage(res.body, 'pairing code invalid or expired'), res.status);
  if (res.status >= 500) throw new GatewayClientError('UNREACHABLE', errorMessage(res.body, 'gateway error'), res.status);
  if (res.status !== 201) throw new GatewayClientError('BAD_RESPONSE', `unexpected status ${res.status}`, res.status);
  const parsed = PairingCompleteResponseSchema.safeParse(res.body);
  if (!parsed.success) throw new GatewayClientError('BAD_RESPONSE', 'unexpected pairing response');
  const c = parsed.data;
  if (input.runtimeId !== undefined && c.runtimeId !== input.runtimeId) throw new GatewayClientError('BAD_RESPONSE', 'paired with another runtime');
  return {
    gatewayUrl,
    runtimeId: c.runtimeId,
    deviceId: c.deviceId,
    deviceName: c.device.name,
    pairedAt: c.device.pairedAt,
    scopes: c.scopes,
    accessToken: c.accessToken,
    accessTokenExpiresAt: c.accessTokenExpiresAt,
    refreshToken: c.refreshToken,
  };
}

/**
 * `POST /v1/auth/refresh`: rotates the refresh token. The presented token is retired by the gateway, so
 * the returned credentials MUST be persisted before the old ones are forgotten — presenting a retired
 * token again is treated as theft and revokes the phone.
 */
export async function refreshCredentials(creds: GatewayCredentials, opts: HttpOptions = {}): Promise<GatewayCredentials> {
  const res = await postJson(`${normalizeGatewayUrl(creds.gatewayUrl)}/v1/auth/refresh`, { refreshToken: creds.refreshToken }, opts);
  if (res.status === 403) throw new GatewayClientError('REVOKED', errorMessage(res.body, 'device revoked'), 403);
  if (res.status === 401) {
    const message = errorMessage(res.body, 'invalid refresh token');
    /* Reuse detection revokes the device server-side: report it as such. */
    throw new GatewayClientError(/reuse/i.test(message) ? 'REVOKED' : 'UNAUTHORIZED', message, 401);
  }
  if (res.status === 429 || res.status >= 500) throw new GatewayClientError('UNREACHABLE', errorMessage(res.body, 'gateway error'), res.status);
  if (res.status !== 200) throw new GatewayClientError('BAD_RESPONSE', `unexpected status ${res.status}`, res.status);
  const parsed = IssuedCredentialsSchema.safeParse(res.body);
  if (!parsed.success) throw new GatewayClientError('BAD_RESPONSE', 'unexpected refresh response');
  if (parsed.data.deviceId !== creds.deviceId || parsed.data.runtimeId !== creds.runtimeId) throw new GatewayClientError('BAD_RESPONSE', 'credentials for another device');
  return {
    ...creds,
    scopes: parsed.data.scopes,
    accessToken: parsed.data.accessToken,
    accessTokenExpiresAt: parsed.data.accessTokenExpiresAt,
    refreshToken: parsed.data.refreshToken,
  };
}

export interface GatewaySessionOptions extends HttpOptions {
  credentials: GatewayCredentials;
  /** Persists rotated credentials (keychain). Awaited before the new access token is handed out. */
  onCredentials: (credentials: GatewayCredentials) => void | Promise<void>;
  /** Refresh this long before the access token expires (default 60 s). */
  refreshMarginMs?: number;
  /** Minimum delay between two forced refreshes (default 30 s), so a flapping socket cannot burn tokens. */
  forcedRefreshIntervalMs?: number;
  now?: () => number;
}

/**
 * Holds one phone's credentials and hands out a valid access token. Refreshes are single-flight: the
 * gateway rotates refresh tokens and treats a retired one as stolen, so two concurrent refreshes with the
 * same token would revoke the phone.
 */
export class GatewaySession {
  private creds: GatewayCredentials;
  private inflight: Promise<GatewayCredentials> | null = null;
  private lastForcedAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;

  constructor(private readonly opts: GatewaySessionOptions) {
    this.creds = opts.credentials;
    this.now = opts.now ?? Date.now;
  }

  get credentials(): GatewayCredentials {
    return this.creds;
  }

  /** The device WebSocket URL for these credentials. */
  get connectUrl(): string {
    return deviceConnectUrl(this.creds.gatewayUrl);
  }

  /**
   * A valid access token, refreshed when it is about to expire. `force` refreshes even when the token looks
   * valid (the gateway refused it: clock skew, gateway restart) — at most once per `forcedRefreshIntervalMs`.
   */
  async accessToken(options: { force?: boolean } = {}): Promise<string> {
    const now = this.now();
    const expiresAt = Date.parse(this.creds.accessTokenExpiresAt);
    const expiring = !Number.isFinite(expiresAt) || expiresAt - (this.opts.refreshMarginMs ?? 60_000) <= now;
    const forced = options.force === true && now - this.lastForcedAt >= (this.opts.forcedRefreshIntervalMs ?? 30_000);
    if (!expiring && !forced && !this.inflight) return this.creds.accessToken;
    if (forced) this.lastForcedAt = now;
    return (await this.refresh()).accessToken;
  }

  private refresh(): Promise<GatewayCredentials> {
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          const next = await refreshCredentials(this.creds, this.opts);
          /* The old refresh token is retired now: keep the new one in memory whatever happens, then persist
           * before handing out the access token, so the keychain holds the only token still valid. */
          this.creds = next;
          await this.opts.onCredentials(next);
          return next;
        } finally {
          this.inflight = null;
        }
      })();
    }
    return this.inflight;
  }
}
