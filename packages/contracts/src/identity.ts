import { z } from 'zod';

/*
 * Runtime identity (docs/security/remote-access.md §5, phase 6 step 3).
 *
 * Each runtime holds an Ed25519 key pair. Its public key reaches the phone out of band, in the pairing QR
 * code the desktop renders (a gateway cannot change what the desktop shows). On every connection through the
 * gateway the phone sends a fresh random challenge and the runtime signs it: a gateway can relay the proof,
 * never forge it, so the phone knows the runtime it was paired with is the one answering.
 *
 * Keys, challenges and signatures are lowercase hex so the runtime (node:crypto) and the phone (pure JS)
 * encode them the same way without a base64 implementation.
 */

/** 32-byte Ed25519 public key. */
export const RuntimePublicKeySchema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a 32-byte hex public key');
/** 32 random bytes chosen by the phone for one proof. */
export const IdentityChallengeSchema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a 32-byte hex challenge');

export const RuntimeIdentityProofSchema = z.object({
  runtimeId: z.string().min(3).max(80),
  publicKey: RuntimePublicKeySchema,
  /** Ed25519 signature (64 bytes, hex) of `identityProofMessage(runtimeId, challenge)`. */
  signature: z.string().regex(/^[0-9a-f]{128}$/),
});
export type RuntimeIdentityProof = z.infer<typeof RuntimeIdentityProofSchema>;

/** Domain-separated message the runtime signs: a signature made for anything else can never be replayed here. */
export function identityProofMessage(runtimeId: string, challenge: string): string {
  return `codeo-runtime-identity/v1\n${runtimeId}\n${challenge}`;
}

/** Bytes of the fingerprint shown to people (sha256 prefix of the public key). */
export const FINGERPRINT_BYTES = 10;

/**
 * `A1B2 C3D4 E5F6 0718 293A`: the first 10 bytes of sha256(public key) in groups of four hex digits. The caller
 * hashes (node:crypto on the runtime, @noble/hashes on the phone); both sides format through this function.
 */
export function formatFingerprint(sha256Digest: Uint8Array): string {
  if (sha256Digest.length < FINGERPRINT_BYTES) throw new Error('digest too short');
  let hex = '';
  for (const b of sha256Digest.subarray(0, FINGERPRINT_BYTES)) hex += b.toString(16).padStart(2, '0');
  return hex.toUpperCase().match(/.{4}/g)!.join(' ');
}
