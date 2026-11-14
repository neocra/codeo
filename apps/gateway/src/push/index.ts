import { readFileSync } from 'node:fs';
import type { Clock } from '../clock';
import type { PushConfig } from '../config';
import type { PushProvider } from '../store';
import { createApnsSender } from './apns';
import { createFcmSender, ServiceAccountSchema } from './fcm';
import { loadPrivateKey } from './jwt';
import type { PushSender } from './types';

export { createApnsSender, createHttp2Transport, APNS_HOSTS, type ApnsTransport, type ApnsRequest } from './apns';
export { createFcmSender, type FcmTransport } from './fcm';
export { createPushDispatcher, type PushDispatcher } from './dispatcher';
export type { PushMessage, PushResult, PushSender } from './types';

/** Builds the senders whose credentials are configured; a provider without credentials is simply absent. */
export function createPushSenders(config: PushConfig, clock: Clock): Partial<Record<PushProvider, PushSender>> {
  const senders: Partial<Record<PushProvider, PushSender>> = {};
  if (config.apns) {
    senders.apns = createApnsSender({
      key: loadPrivateKey(readFileSync(config.apns.keyPath, 'utf8'), 'APNS_KEY_PATH'),
      keyId: config.apns.keyId,
      teamId: config.apns.teamId,
      topic: config.apns.topic,
      now: clock,
    });
  }
  if (config.fcm) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(config.fcm.serviceAccountPath, 'utf8'));
    } catch {
      throw new Error('FCM_SERVICE_ACCOUNT_PATH: not a readable JSON file');
    }
    const account = ServiceAccountSchema.safeParse(raw);
    if (!account.success) throw new Error('FCM_SERVICE_ACCOUNT_PATH: not a Google service-account key (project_id, client_email, private_key)');
    senders.fcm = createFcmSender({
      projectId: account.data.project_id,
      clientEmail: account.data.client_email,
      key: loadPrivateKey(account.data.private_key, 'FCM_SERVICE_ACCOUNT_PATH'),
      tokenUri: account.data.token_uri,
      now: clock,
    });
  }
  return senders;
}
