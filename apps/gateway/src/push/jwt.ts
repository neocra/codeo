import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

const b64url = (v: string | Buffer): string => Buffer.from(v).toString('base64url');

/**
 * Compact JWS for the push providers' token auth: ES256 for APNs (raw r||s signature, not DER),
 * RS256 for Google's OAuth service-account assertion.
 */
export function signJwt(alg: 'ES256' | 'RS256', header: Record<string, string>, claims: Record<string, unknown>, key: KeyObject): string {
  const input = `${b64url(JSON.stringify({ alg, typ: 'JWT', ...header }))}.${b64url(JSON.stringify(claims))}`;
  const signature =
    alg === 'ES256' ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }) : sign('sha256', Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

/** Parses a PEM private key; the error never quotes the key. */
export function loadPrivateKey(pem: string, what: string): KeyObject {
  try {
    return createPrivateKey(pem);
  } catch {
    throw new Error(`${what}: not a valid PEM private key`);
  }
}
