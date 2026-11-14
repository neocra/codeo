import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { approvalFromNotification, pushSupported, syncPush } from '@/lib/push';
import { gatewaySession, useRuntime } from '@/lib/runtime';
import { useSettings } from '@/lib/settings';

/**
 * Keeps the gateway's copy of this phone's push token current while the phone is paired, and opens the
 * approvals tab when an approval notification for the paired runtime is tapped. Renders nothing.
 */
export function PushRegistration() {
  const { mode, state } = useRuntime();
  const locale = useSettings((s) => s.locale);
  const runtimeId = useSettings((s) => s.gateway?.runtimeId ?? null);
  const prompted = useRef(false);
  const connected = mode === 'gateway' && state === 'connected';

  useEffect(() => {
    if (!connected) return;
    /* The permission is asked once, on the first connection after pairing; later runs only refresh the token. */
    const prompt = !prompted.current;
    prompted.current = true;
    void syncPush({ session: gatewaySession(), locale, prompt });
  }, [connected, locale]);

  useEffect(() => {
    if (!connected || !pushSupported) return;
    const sub = Notifications.addPushTokenListener(() => {
      void syncPush({ session: gatewaySession(), locale, prompt: false });
    });
    return () => sub.remove();
  }, [connected, locale]);

  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || runtimeId === null) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const approval = approvalFromNotification(response);
    /* A notification for another runtime (an older pairing) is not acted on. */
    if (approval && approval.runtimeId === runtimeId) router.push('/(tabs)/approvals');
  }, [response, runtimeId]);

  return null;
}
