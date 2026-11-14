import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { translate, type Locale } from '@codeo/i18n';
import {
  ApprovalPushDataSchema,
  registerPushToken,
  unregisterPushToken,
  type ApprovalPushData,
  type GatewaySession,
  type PushRegistration,
} from '@codeo/remote-client';

/*
 * Approval notifications (docs/security/remote-access.md §5). The gateway pushes ids only; the app shows
 * nothing of the approval until it is opened and reads it over the authenticated relay. Native tokens
 * (APNs on iOS, FCM on Android) go to the gateway the phone is paired with, never to a third-party relay.
 */

export type PushStatus = 'idle' | 'unsupported' | 'off' | 'denied' | 'pending' | 'enabled' | 'unconfigured' | 'error';

interface PushState {
  status: PushStatus;
  error: string | null;
  /** `deviceId|provider|token|locale` last accepted by the gateway: registering again is skipped when equal. */
  registered: string | null;
}

export const usePush = create<PushState>()(() => ({ status: 'idle', error: null, registered: null }));

const CHANNEL_ID = 'approvals';

/** Expo Go has no push entitlement for this app (and none at all on Android since SDK 53). */
export const pushSupported = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && (Platform.OS === 'ios' || Platform.OS === 'android');

/* In front, the relay already put the approval on screen: no banner, no sound. */
if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

async function apnsEnvironment(): Promise<'sandbox' | 'production'> {
  try {
    const env = await Application.getIosPushNotificationServiceEnvironmentAsync();
    if (env === 'production') return 'production';
    if (env === 'development') return 'sandbox';
  } catch {
    /* not provisioned for push: fall through */
  }
  return __DEV__ ? 'sandbox' : 'production';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SyncPushOptions {
  session: GatewaySession;
  locale: Locale;
  /** Ask the system permission when it was never asked (first connection, or the user pressed the button). */
  prompt: boolean;
}

/** Makes sure the gateway holds this phone's current push token. Never throws: the outcome is in `usePush`. */
export async function syncPush({ session, locale, prompt }: SyncPushOptions): Promise<void> {
  if (!pushSupported) {
    usePush.setState({ status: 'unsupported', error: null });
    return;
  }
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status === 'undetermined' && prompt) permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      usePush.setState({ status: permission.status === 'denied' ? 'denied' : 'off', error: null });
      return;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: translate(locale, 'mobile.push.channel'),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const device = await Notifications.getDevicePushTokenAsync();
    if (typeof device.data !== 'string' || device.data.length === 0) throw new Error('no push token');
    const registration: PushRegistration =
      Platform.OS === 'ios'
        ? { provider: 'apns', token: device.data, environment: await apnsEnvironment(), locale }
        : { provider: 'fcm', token: device.data, locale };
    const key = `${session.credentials.deviceId}|${registration.provider}|${registration.token}|${locale}`;
    const current = usePush.getState();
    if (current.registered === key && (current.status === 'enabled' || current.status === 'unconfigured')) return;
    usePush.setState({ status: 'pending', error: null });
    const delivery = await registerPushToken(session, registration);
    usePush.setState({ status: delivery, error: null, registered: key });
  } catch (err) {
    usePush.setState({ status: 'error', error: errMessage(err) });
  }
}

/** Best effort, before the pairing is forgotten: the desktop revoking the phone removes it too. */
export async function stopPush(session: GatewaySession): Promise<void> {
  usePush.setState({ status: 'idle', error: null, registered: null });
  if (!pushSupported) return;
  try {
    await unregisterPushToken(session, { timeoutMs: 5_000 });
  } catch {
    /* offline or already revoked: the gateway forgets the token when the device is revoked */
  }
}

/**
 * The approval a tapped notification points at, or null for anything else. iOS keeps the gateway's
 * custom `codeo` key in the raw APNs payload, Android puts the FCM data in `content.data`.
 */
export function approvalFromNotification(response: Notifications.NotificationResponse): ApprovalPushData | null {
  const { request } = response.notification;
  const trigger = request.trigger as { payload?: Record<string, unknown>; remoteMessage?: { data?: Record<string, unknown> } } | null;
  const content = request.content.data as Record<string, unknown> | null;
  const candidates: unknown[] = [content, content?.codeo, trigger?.payload?.codeo, trigger?.remoteMessage?.data];
  for (const candidate of candidates) {
    const parsed = ApprovalPushDataSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return null;
}
