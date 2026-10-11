import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { AgentSession, Task } from '@codeo/domain';
import { formatRelative } from '@codeo/i18n';
import { EmptyState, FilterPills, TaskRow, Typo, useTheme } from '@codeo/ui-mobile';
import { NotConnected } from '@/components/NotConnected';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { ACTIVE_TASK_STATUSES, DONE_TASK_STATUSES, WAITING_TASK_STATUSES, taskPill } from '@/lib/presentation';
import { useCommand, useRuntime } from '@/lib/runtime';

type Filter = 'all' | 'active' | 'waiting' | 'done';

const matches = (task: Task, filter: Filter): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return ACTIVE_TASK_STATUSES.includes(task.status);
    case 'waiting':
      return WAITING_TASK_STATUSES.includes(task.status);
    case 'done':
      return DONE_TASK_STATUSES.includes(task.status);
  }
};

export default function TasksScreen() {
  const t = useT();
  const { theme } = useTheme();
  const { state } = useRuntime();
  const [filter, setFilter] = useState<Filter>('all');
  const tasks = useCommand('tasks.list', {});
  const workspaces = useCommand('workspaces.list', {});
  const sessions = useCommand('sessions.list', {});

  const repoNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaces.data ?? []) for (const r of ws.repositories) map.set(r.id, r.name);
    return map;
  }, [workspaces.data]);

  const latestSessionByTask = useMemo(() => {
    const map = new Map<string, AgentSession>();
    for (const s of sessions.data ?? []) {
      if (s.taskId === null) continue;
      const current = map.get(s.taskId);
      if (!current || s.lastActivityAt > current.lastActivityAt) map.set(s.taskId, s);
    }
    return map;
  }, [sessions.data]);

  if (state !== 'connected') {
    return (
      <Screen title={t('tasks.title')} subtitle={t('tasks.subtitle')}>
        <NotConnected />
      </Screen>
    );
  }

  const all = [...(tasks.data ?? [])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const visible = all.filter((task) => matches(task, filter));
  const options = [
    { id: 'all', label: t('tasks.filter.all'), count: all.length },
    { id: 'active', label: t('tasks.filter.active'), count: all.filter((x) => matches(x, 'active')).length },
    { id: 'waiting', label: t('tasks.filter.waiting'), count: all.filter((x) => matches(x, 'waiting')).length },
    { id: 'done', label: t('tasks.filter.done'), count: all.filter((x) => matches(x, 'done')).length },
  ] as const;

  const meta = (task: Task): string => {
    const repos = task.repositoryIds.map((id) => repoNames.get(id) ?? id).join(', ');
    const agents = Math.max(1, task.subtasks.length);
    const parts = [
      repos,
      agents > 1 ? t('tasks.agents.plural', { n: agents }) : t('tasks.agents', { n: agents }),
      formatRelative(t, task.updatedAt),
    ].filter((p) => p.length > 0);
    return parts.join(' · ');
  };

  return (
    <Screen title={t('tasks.title')} subtitle={t('tasks.subtitle')} onRefresh={() => void tasks.refetch()} refreshing={tasks.isRefetching}>
      <FilterPills options={options} value={filter} onChange={setFilter} />
      {tasks.isPending ? (
        <Typo variant="body-sm" color="ink-muted">
          {t('mobile.loading')}
        </Typo>
      ) : null}
      {tasks.isError ? (
        <Typo variant="body-sm" color="coral">
          {tasks.error.message}
        </Typo>
      ) : null}
      {tasks.data && visible.length === 0 ? <EmptyState title={t('tasks.empty')} /> : null}
      <View style={{ gap: theme.spacing['space-3'] }}>
        {visible.map((task) => {
          const session = latestSessionByTask.get(task.id);
          return (
            <TaskRow
              key={task.id}
              ticketKey={task.ticketKey}
              title={task.title}
              pill={taskPill(task.status, t)}
              progress={task.progress}
              meta={meta(task)}
              {...(session ? { onPress: () => router.push(`/session/${session.id}`) } : {})}
            />
          );
        })}
      </View>
    </Screen>
  );
}
