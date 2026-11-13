import {
  formatFingerprint,
  identityProofMessage,
  RuntimeIdentityProofSchema,
  RuntimePublicKeySchema,
  type CommandName,
  type CommandParams,
  type CommandResult,
} from '@codeo/contracts';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/*
 * Phone side of the runtime identity check (`@codeo/contracts` identity.ts). Pure JavaScript, so it runs the
 * same in React Native (Hermes has no WebCrypto Ed25519) and in Node tests. Random bytes come from the caller:
 * React Native has no `crypto.getRandomValues` unless the app provides one (expo-crypto).
 */

export type RuntimeIdentityErrorCode =
  /** The runtime answered with another key than the one pinned at pairing. */
  | 'KEY_MISMATCH'
  /** The signature does not verify, or the proof is for another runtime. */
  | 'BAD_PROOF';

/** The runtime behind the gateway is not the one this phone was paired with. Terminal: never retried. */
export class RuntimeIdentityError extends Error {
  constructor(
    readonly code: RuntimeIdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeIdentityError';
  }
}

export function isRuntimePublicKey(value: unknown): value is string {
  return RuntimePublicKeySchema.safeParse(value).success;
}

/** Fingerprint of a hex public key, formatted like the desktop shows it. */
export function runtimeFingerprint(publicKeyHex: string): string {
  return formatFingerprint(sha256(hexToBytes(publicKeyHex)));
}

/** Sends one command on a connection that is not handed to the app yet (see `RuntimeClientOptions.verify`). */
export type VerifyRequest = <C extends CommandName>(command: C, params: CommandParams<C>) => Promise<CommandResult<C>>;

export interface RuntimeIdentityCheckOptions {
  /** The runtime this phone was paired with. */
  runtimeId: string;
  /** The key from the pairing QR code, or the one accepted on first use; null when none is pinned yet. */
  pinnedKey: () => string | null;
  /** Called once when no key was pinned (code typed by hand, or a pairing older than this check). */
  onFirstUse: (publicKey: string) => void | Promise<void>;
  randomBytes: (length: number) => Uint8Array;
}

/**
 * Builds the check `RuntimeClient` runs on every connection before anything else: send a fresh 32-byte
 * challenge, verify the Ed25519 signature, compare the key with the pinned one. A gateway can relay the proof
 * but cannot produce it without the runtime's private key.
 */
export function runtimeIdentityCheck(opts: RuntimeIdentityCheckOptions): (request: VerifyRequest) => Promise<void> {
  return async (request) => {
    const random = opts.randomBytes(32);
    if (random.length !== 32) throw new Error('randomBytes returned the wrong length');
    const challenge = bytesToHex(random);
    const raw = await request('remote.identity', { challenge });
    const parsed = RuntimeIdentityProofSchema.safeParse(raw);
    if (!parsed.success) throw new RuntimeIdentityError('BAD_PROOF', 'malformed identity proof');
    const proof = parsed.data;
    if (proof.runtimeId !== opts.runtimeId) throw new RuntimeIdentityError('BAD_PROOF', 'identity proof for another runtime');
    let valid = false;
    try {
      valid = ed25519.verify(hexToBytes(proof.signature), utf8ToBytes(identityProofMessage(proof.runtimeId, challenge)), hexToBytes(proof.publicKey), {
        zip215: false,
      });
    } catch {
      valid = false;
    }
    if (!valid) throw new RuntimeIdentityError('BAD_PROOF', 'invalid identity signature');
    const pinned = opts.pinnedKey();
    if (pinned === null) {
      await opts.onFirstUse(proof.publicKey);
      return;
    }
    if (pinned !== proof.publicKey) throw new RuntimeIdentityError('KEY_MISMATCH', 'the runtime key changed since pairing');
  };
}
