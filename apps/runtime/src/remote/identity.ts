import { formatFingerprint, identityProofMessage, type RuntimeIdentityProof } from '@codeo/contracts';
import { createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/*
 * This runtime's identity key (docs/security/remote-access.md §5). One Ed25519 key pair per runtime, kept
 * across gateway registrations so a phone's pinned key stays valid. The private key never leaves the runtime:
 * it is stored in the local database next to the runtime secret, and only signatures go out.
 */

export interface StoredIdentity {
  /** Raw 32-byte public key, hex. */
  publicKey: string;
  /** PKCS#8 DER, base64. */
  privateKey: string;
}

export class RuntimeIdentity {
  private readonly key: KeyObject;
  readonly fingerprint: string;

  private constructor(readonly stored: StoredIdentity) {
    this.key = createPrivateKey({ key: Buffer.from(stored.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
    if (rawPublicKey(this.key) !== stored.publicKey) throw new Error('stored runtime identity is inconsistent');
    this.fingerprint = fingerprintOf(stored.publicKey);
  }

  get publicKey(): string {
    return this.stored.publicKey;
  }

  static generate(): RuntimeIdentity {
    const { privateKey } = generateKeyPairSync('ed25519');
    return new RuntimeIdentity({
      publicKey: rawPublicKey(privateKey),
      privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    });
  }

  /** Null when nothing usable is stored (absent or corrupt): the caller generates a new key. */
  static load(stored: unknown): RuntimeIdentity | null {
    if (typeof stored !== 'object' || stored === null) return null;
    const { publicKey, privateKey } = stored as Partial<StoredIdentity>;
    if (typeof publicKey !== 'string' || typeof privateKey !== 'string') return null;
    try {
      return new RuntimeIdentity({ publicKey, privateKey });
    } catch {
      return null;
    }
  }

  /** Signs a phone's challenge for this runtime id. */
  prove(runtimeId: string, challenge: string): RuntimeIdentityProof {
    const signature = sign(null, Buffer.from(identityProofMessage(runtimeId, challenge), 'utf8'), this.key).toString('hex');
    return { runtimeId, publicKey: this.publicKey, signature };
  }
}

function rawPublicKey(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('not an Ed25519 key');
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}

export function fingerprintOf(publicKeyHex: string): string {
  return formatFingerprint(createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest());
}
