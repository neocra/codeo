import { describe, expect, it } from 'vitest';
import { generateRuntimeSecret, hashSecret, runtimeIdFromSecret, safeEqual, TokenService } from '../src/tokens';

const SECRET = 'unit-test-secret-0123456789abcdef0123456789';
const T0 = Date.UTC(2026, 0, 1);

describe('TokenService', () => {
  const tokens = new TokenService(SECRET);

  it('issues a token that verifies with the same key', () => {
    const { token, expiresAt } = tokens.issueAccessToken({ deviceId: 'dev_1', runtimeId: 'rt_1', scopes: ['read'], ttlSeconds: 900, now: T0 });
    expect(token.startsWith('v1.')).toBe(true);
    expect(expiresAt).toBe(T0 + 900_000);
    const v = tokens.verifyAccessToken(token, T0 + 1000);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.claims).toMatchObject({ deviceId: 'dev_1', runtimeId: 'rt_1', scopes: ['read'], expiresAt: T0 + 900_000 });
      expect(v.claims.jti.startsWith('tok_')).toBe(true);
    }
  });

  it('rejects an expired token', () => {
    const { token } = tokens.issueAccessToken({ deviceId: 'dev_1', runtimeId: 'rt_1', scopes: ['read'], ttlSeconds: 60, now: T0 });
    expect(tokens.verifyAccessToken(token, T0 + 59_000).ok).toBe(true);
    expect(tokens.verifyAccessToken(token, T0 + 60_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token whose claims were tampered with', () => {
    const { token } = tokens.issueAccessToken({ deviceId: 'dev_1', runtimeId: 'rt_1', scopes: ['read'], ttlSeconds: 900, now: T0 });
    const [version, payload, sig] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    claims['scp'] = ['read', 'workspace:admin'];
    const forged = `${version}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
    expect(tokens.verifyAccessToken(forged, T0)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token signed with another key', () => {
    const other = new TokenService('another-secret-0123456789abcdef0123456789xyz');
    const { token } = other.issueAccessToken({ deviceId: 'dev_1', runtimeId: 'rt_1', scopes: ['read'], ttlSeconds: 900, now: T0 });
    expect(tokens.verifyAccessToken(token, T0)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects malformed input without throwing', () => {
    expect(tokens.verifyAccessToken('', T0)).toEqual({ ok: false, reason: 'malformed' });
    expect(tokens.verifyAccessToken('v1.abc', T0)).toEqual({ ok: false, reason: 'malformed' });
    expect(tokens.verifyAccessToken('v2.abc.def', T0)).toEqual({ ok: false, reason: 'malformed' });
    expect(tokens.verifyAccessToken('v1.abc.def', T0)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses a weak secret', () => {
    expect(() => new TokenService('short')).toThrow();
  });
});

describe('secret helpers', () => {
  it('safeEqual compares without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('runtime secrets embed the runtime id and hash deterministically', () => {
    const secret = generateRuntimeSecret('rt_abc');
    expect(runtimeIdFromSecret(secret)).toBe('rt_abc');
    expect(runtimeIdFromSecret('nodot')).toBeNull();
    expect(hashSecret(secret)).toBe(hashSecret(secret));
    expect(hashSecret(secret)).not.toBe(hashSecret(generateRuntimeSecret('rt_abc')));
  });
});
