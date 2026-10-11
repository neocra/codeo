import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, EmptyState, StatusPill, Typo, useTheme } from '@codeo/ui-mobile';
import { useT } from '@/lib/i18n';
import { connectionStateLabel, connectionTone } from '@/lib/presentation';
import { useRuntime } from '@/lib/runtime';

/** Calm empty state shown by every screen while the runtime is not connected. */
export function NotConnected() {
  const t = useT();
  const { theme } = useTheme();
  const { configured, state, error } = useRuntime();

  if (!configured) {
    return (
      <EmptyState
        title={t('mobile.notConnected.title')}
        body={t('mobile.notConnected.body')}
        action={<Button variant="primary" icon="settings" label={t('mobile.notConnected.action')} onPress={() => router.navigate('/more')} />}
      />
    );
  }

  return (
    <EmptyState
      title={connectionStateLabel(state, t)}
      body={error ?? (state === 'closed' ? t('runtime.disconnected') : t('runtime.connecting'))}
      action={
        <View style={{ alignItems: 'center', gap: theme.spacing['space-3'] }}>
          <StatusPill tone={connectionTone(state)} label={connectionStateLabel(state, t)} />
          <Typo variant="body-sm" color="ink-faint" align="center">
            {t('settings.connection.hint')}
          </Typo>
        </View>
      }
    />
  );
}
