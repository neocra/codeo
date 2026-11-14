import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { approvalFromNotification, dismissResolvedApprovals, pushSupported, syncPush } from '@/lib/push';
import { gatewaySession, useCommand, useRuntime } from '@/lib/runtime';
import { useSettings } from '@/lib/settings';

/**
 * Keeps the gateway's copy of this phone's push token current while the phone is paired, opens the
 * approvals tab when an approval notification for the paired runtime is tapped, and withdraws the
 * notifications of approvals that are no longer pending. Renders nothing.
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

  /* The pending list is invalidated by every ApprovalRequested / ApprovalResolved event and re-read when the
   * app comes back to the front, so a notification is withdrawn as soon as the app learns it is decided. */
  const pending = useCommand('approvals.list', { status: 'pending' }, { enabled: connected && pushSupported });
  const { refetch } = pending;
  useEffect(() => {
    if (!connected || !pushSupported) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refetch();
    });
    return () => sub.remove();
  }, [connected, refetch]);

  useEffect(() => {
    if (!pending.data || runtimeId === null) return;
    void dismissResolvedApprovals({ runtimeId, ids: new Set(pending.data.map((a) => a.id)), listedAt: pending.dataUpdatedAt });
  }, [pending.data, pending.dataUpdatedAt, runtimeId]);

  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || runtimeId === null) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const approval = approvalFromNotification(response.notification);
    /* A notification for another runtime (an older pairing) is not acted on. */
    if (approval && approval.runtimeId === runtimeId) router.push('/(tabs)/approvals');
  }, [response, runtimeId]);

  return null;
}
