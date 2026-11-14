import type { PushProvider, PushTokenRecord } from '../store';

/**
 * What a push carries. Content-free by design (docs/security/remote-access.md §5): ids only, and a generic,
 * localized text — never the tool, the command, a path or a summary. The phone fetches the approval itself
 * over the authenticated relay once it is opened.
 */
export interface PushMessage {
  kind: 'approval';
  runtimeId: string;
  approvalId: string;
  title: string;
  body: string;
  /** The approval's expiry: providers drop the push once it is useless. */
  expiresAt: number;
}

export type PushResult =
  | { ok: true }
  /** The provider says this token will never work again (app uninstalled, token rotated): forget it. */
  | { ok: false; invalidToken: true; reason: string }
  | { ok: false; invalidToken: false; reason: string };

export interface PushSender {
  readonly provider: PushProvider;
  send(target: PushTokenRecord, message: PushMessage): Promise<PushResult>;
  close(): Promise<void>;
}

/** The smallest HTTP surface the senders need; tests replace it, the default uses fetch / node:http2. */
export interface HttpResponse {
  status: number;
  body: string;
}
