import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { AgentSession } from '@codeo/domain';
import { EmptyState, FilterPills, Typo, useTheme } from '@codeo/ui-mobile';
import { NotConnected } from '@/components/NotConnected';
import { Screen } from '@/components/Screen';
import { SessionRow } from '@/components/SessionRow';
import { useT } from '@/lib/i18n';
import { ACTIVE_SESSION_STATUSES, DONE_SESSION_STATUSES } from '@/lib/presentation';
import { useCommand, useRuntime } from '@/lib/runtime';

type Filter = 'all' | 'active' | 'done';

const matches = (session: AgentSession, filter: Filter): boolean =>
  filter === 'all' ||
  (filter === 'active' ? ACTIVE_SESSION_STATUSES.includes(session.status) : DONE_SESSION_STATUSES.includes(session.status));

export default function SessionsScreen() {
  const t = useT();
  const { theme } = useTheme();
  const { state } = useRuntime();
  const [filter, setFilter] = useState<Filter>('all');
  const sessions = useCommand('sessions.list', {});

  if (state !== 'connected') {
    return (
      <Screen title={t('sessions.title')} subtitle={t('sessions.subtitle')}>
        <NotConnected />
      </Screen>
    );
  }

  const all = [...(sessions.data ?? [])].sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  const visible = all.filter((s) => matches(s, filter));
  const options = [
    { id: 'all', label: t('sessions.filter.all'), count: all.length },
    { id: 'active', label: t('sessions.filter.active'), count: all.filter((s) => matches(s, 'active')).length },
    { id: 'done', label: t('sessions.filter.done'), count: all.filter((s) => matches(s, 'done')).length },
  ] as const;

  return (
    <Screen
      title={t('sessions.title')}
      subtitle={t('sessions.subtitle')}
      onRefresh={() => void sessions.refetch()}
      refreshing={sessions.isRefetching}
    >
      <FilterPills options={options} value={filter} onChange={setFilter} />
      {sessions.isPending ? (
        <Typo variant="body-sm" color="ink-muted">
          {t('mobile.loading')}
        </Typo>
      ) : null}
      {sessions.isError ? (
        <Typo variant="body-sm" color="coral">
          {sessions.error.message}
        </Typo>
      ) : null}
      {sessions.data && visible.length === 0 ? <EmptyState title={t('sessions.empty')} /> : null}
      <View style={{ gap: theme.spacing['space-2'] }}>
        {visible.map((session) => (
          <SessionRow key={session.id} session={session} onPress={() => router.push(`/session/${session.id}`)} />
        ))}
      </View>
    </Screen>
  );
}
