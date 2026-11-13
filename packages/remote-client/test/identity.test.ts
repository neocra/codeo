import { identityProofMessage, type RuntimeIdentityProof } from '@codeo/contracts';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RuntimeIdentityError, runtimeFingerprint, runtimeIdentityCheck, type VerifyRequest } from '../src/index';

/* A runtime key made with node:crypto, like apps/runtime/src/remote/identity.ts: the phone side must accept it. */
function runtimeKey(): { key: KeyObject; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  return { key: privateKey, publicKey: Buffer.from(jwk.x!, 'base64url').toString('hex') };
}

function prove(key: KeyObject, publicKey: string, runtimeId: string, challenge: string): RuntimeIdentityProof {
  return { runtimeId, publicKey, signature: sign(null, Buffer.from(identityProofMessage(runtimeId, challenge)), key).toString('hex') };
}

/** A `request` that answers `remote.identity` with whatever `answer` builds from the challenge. */
function answering(answer: (challenge: string) => unknown): VerifyRequest {
  return (async (command: string, params: { challenge: string }) => {
    expect(command).toBe('remote.identity');
    return answer(params.challenge);
  }) as VerifyRequest;
}

const rt = runtimeKey();
const base = { runtimeId: 'rt_test', onFirstUse: () => undefined, randomBytes: (n: number) => new Uint8Array(randomBytes(n)) };

describe('runtime identity check', () => {
  it('accepts a proof signed by the pinned key', async () => {
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => rt.publicKey });
    await expect(check(answering((c) => prove(rt.key, rt.publicKey, 'rt_test', c)))).resolves.toBeUndefined();
  });

  it('sends a fresh challenge each time', async () => {
    const seen = new Set<string>();
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => rt.publicKey });
    for (let i = 0; i < 3; i++) await check(answering((c) => (seen.add(c), prove(rt.key, rt.publicKey, 'rt_test', c))));
    expect(seen.size).toBe(3);
  });

  it('refuses a replayed proof (signed for another challenge)', async () => {
    const old = prove(rt.key, rt.publicKey, 'rt_test', '00'.repeat(32));
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => rt.publicKey });
    await expect(check(answering(() => old))).rejects.toMatchObject({ code: 'BAD_PROOF' });
  });

  it('refuses another key, even with a valid signature', async () => {
    const other = runtimeKey();
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => rt.publicKey });
    await expect(check(answering((c) => prove(other.key, other.publicKey, 'rt_test', c)))).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
  });

  it('refuses a proof that claims the pinned key without its private key', async () => {
    const other = runtimeKey();
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => rt.publicKey });
    await expect(check(answering((c) => ({ ...prove(other.key, other.publicKey, 'rt_test', c), publicKey: rt.publicKey })))).rejects.toBeInstanceOf(RuntimeIdentityError);
  });

  it('refuses malformed answers', async () => {
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => null });
    await expect(check(answering(() => ({ runtimeId: 'rt_test' })))).rejects.toMatchObject({ code: 'BAD_PROOF' });
  });

  it('pins the key on first use', async () => {
    let pinned: string | null = null;
    const check = runtimeIdentityCheck({ ...base, pinnedKey: () => pinned, onFirstUse: (k) => void (pinned = k) });
    await check(answering((c) => prove(rt.key, rt.publicKey, 'rt_test', c)));
    expect(pinned).toBe(rt.publicKey);
  });

  it('formats the fingerprint like the runtime', () => {
    const digest = createHash('sha256').update(Buffer.from(rt.publicKey, 'hex')).digest('hex').slice(0, 20).toUpperCase();
    expect(runtimeFingerprint(rt.publicKey).replaceAll(' ', '')).toBe(digest);
  });
});
