import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CommandScopeSchema, type CommandScope } from '@codeo/contracts';
import { newId } from '@codeo/shared-utils';

/*
 * Access tokens: compact HMAC-SHA256 signed tokens, `v1.<base64url(json claims)>.<base64url(sig)>`.
 * No external JWT library: one algorithm, one key, no header negotiation (no `alg: none` class of bugs).
 * Refresh tokens and runtime secrets are opaque random strings; only their sha256 is stored.
 */

const TOKEN_VERSION = 'v1';

const ClaimsSchema = z.object({
  /** Device id. */
  sub: z.string().min(1),
  /** Runtime id the device is paired with. */
  rt: z.string().min(1),
  scp: z.array(CommandScopeSchema),
  /** Seconds since epoch. */
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});

export interface AccessTokenClaims {
  deviceId: string;
  runtimeId: string;
  scopes: CommandScope[];
  /** Epoch milliseconds. */
  issuedAt: number;
  expiresAt: number;
  jti: string;
}

export type VerifyFailure = 'malformed' | 'bad-signature' | 'invalid-claims' | 'expired';
export type VerifyResult = { ok: true; claims: AccessTokenClaims } | { ok: false; reason: VerifyFailure };

export interface IssueAccessTokenInput {
  deviceId: string;
  runtimeId: string;
  scopes: readonly CommandScope[];
  ttlSeconds: number;
  /** Epoch milliseconds; defaults to Date.now(). */
  now?: number | undefined;
}

export class TokenService {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error('token secret must be at least 32 characters');
    this.key = Buffer.from(secret, 'utf8');
  }

  issueAccessToken(input: IssueAccessTokenInput): { token: string; expiresAt: number; jti: string } {
    const nowSec = Math.floor((input.now ?? Date.now()) / 1000);
    const claims: z.infer<typeof ClaimsSchema> = {
      sub: input.deviceId,
      rt: input.runtimeId,
      scp: [...input.scopes],
      iat: nowSec,
      exp: nowSec + input.ttlSeconds,
      jti: newId('tok'),
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signingInput = `${TOKEN_VERSION}.${payload}`;
    const sig = this.sign(signingInput);
    return { token: `${signingInput}.${sig}`, expiresAt: claims.exp * 1000, jti: claims.jti };
  }

  verifyAccessToken(token: string, now: number = Date.now()): VerifyResult {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const version = parts[0];
    const payload = parts[1];
    const sig = parts[2];
    if (version !== TOKEN_VERSION || !payload || !sig) return { ok: false, reason: 'malformed' };

    /* Verify the signature before looking at the payload: untrusted bytes are never parsed first. */
    const expected = this.sign(`${version}.${payload}`);
    if (!safeEqual(expected, sig)) return { ok: false, reason: 'bad-signature' };

    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    const parsed = ClaimsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid-claims' };
    const c = parsed.data;
    if (c.exp * 1000 <= now) return { ok: false, reason: 'expired' };
    return {
      ok: true,
      claims: { deviceId: c.sub, runtimeId: c.rt, scopes: c.scp, issuedAt: c.iat * 1000, expiresAt: c.exp * 1000, jti: c.jti },
    };
  }

  private sign(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** sha256 hex, used for everything stored at rest (refresh tokens, runtime secrets). */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateRefreshToken(): string {
  return `rft_${randomBytes(32).toString('base64url')}`;
}

/**
 * Runtime secrets are self-describing (`<runtimeId>.<random>`) so a bearer header alone identifies
 * the runtime; the random part is what gets hashed and compared.
 */
export function generateRuntimeSecret(runtimeId: string): string {
  return `${runtimeId}.${randomBytes(32).toString('base64url')}`;
}

export function runtimeIdFromSecret(secret: string): string | null {
  const dot = secret.indexOf('.');
  if (dot <= 0 || dot === secret.length - 1) return null;
  return secret.slice(0, dot);
}
