import { useMemo } from 'react';
import { View } from 'react-native';
import { EmptyState, StatusPill, Typo, useTheme } from '@codeo/ui-mobile';
import { ApprovalInboxCard } from '@/components/ApprovalInboxCard';
import { NotConnected } from '@/components/NotConnected';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { useCommand, useRuntime } from '@/lib/runtime';

/** The approval inbox — the core mobile feature. */
export default function ApprovalsScreen() {
  const t = useT();
  const { theme } = useTheme();
  const { state } = useRuntime();
  const approvals = useCommand('approvals.list', { status: 'pending' }, { refetchInterval: 30_000 });
  const tasks = useCommand('tasks.list', {});

  const taskById = useMemo(() => new Map((tasks.data ?? []).map((task) => [task.id, task] as const)), [tasks.data]);

  if (state !== 'connected') {
    return (
      <Screen title={t('approvals.title')} subtitle={t('approvals.subtitle')}>
        <NotConnected />
      </Screen>
    );
  }

  const pending = [...(approvals.data ?? [])].sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1));

  return (
    <Screen
      title={t('approvals.title')}
      subtitle={t('approvals.subtitle')}
      trailing={pending.length > 0 ? <StatusPill tone="attention" label={`${pending.length}`} pulse={false} /> : undefined}
      onRefresh={() => void approvals.refetch()}
      refreshing={approvals.isRefetching}
    >
      {approvals.isPending ? (
        <Typo variant="body-sm" color="ink-muted">
          {t('mobile.loading')}
        </Typo>
      ) : null}
      {approvals.isError ? (
        <Typo variant="body-sm" color="coral">
          {approvals.error.message}
        </Typo>
      ) : null}
      {approvals.data && pending.length === 0 ? <EmptyState title={t('approvals.empty')} body={t('home.empty.title')} /> : null}
      <View style={{ gap: theme.spacing['space-4'] }}>
        {pending.map((approval) => (
          <ApprovalInboxCard key={approval.id} approval={approval} task={approval.taskId !== null ? taskById.get(approval.taskId) : undefined} />
        ))}
      </View>
    </Screen>
  );
}
