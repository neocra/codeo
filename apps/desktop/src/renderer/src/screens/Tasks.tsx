import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task } from '@codeo/domain';
import { Button, Card, EmptyState, PageHeader, Tabs, TaskRow } from '@codeo/ui-desktop';
import { ApprovalItem } from '../components/ApprovalItem';
import { CreateTaskDialog } from '../components/CreateTaskDialog';
import { taskTone } from '../components/status';
import { invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { usePendingApprovals, useSessions, useTasks, useWorkspaces } from '../lib/queries';
import { useUi } from '../lib/store';

type Filter = 'all' | 'active' | 'waiting' | 'done';
const matches = (t: Task, f: Filter) =>
  f === 'all' ? true : f === 'active' ? ['running', 'queued', 'review'].includes(t.status) : f === 'waiting' ? ['waiting_approval', 'paused', 'draft'].includes(t.status) : ['completed', 'failed', 'cancelled'].includes(t.status);

export function TasksScreen() {
  const t = useT();
  const qc = useQueryClient();
  const { workspaceId, openSession } = useUi();
  const tasks = useTasks(workspaceId);
  const sessions = useSessions(workspaceId);
  const approvals = usePendingApprovals();
  const workspaces = useWorkspaces();
  const ws = workspaces.data?.find((w) => w.id === workspaceId);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = (tasks.data ?? []).filter((x) => matches(x, filter));
  const selectedTask = (tasks.data ?? []).find((x) => x.id === selected) ?? null;
  const start = useMutation({ mutationFn: (taskId: string) => invoke('tasks.start', { taskId }), onSuccess: ({ session }) => openSession(session.id), onSettled: () => void qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const cancel = useMutation({ mutationFn: (taskId: string) => invoke('tasks.cancel', { taskId }), onSettled: () => void qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const repoNames = (ids: string[]) => (ws?.repositories ?? []).filter((r) => ids.includes(r.id)).map((r) => r.name);
  const count = (f: Filter) => (tasks.data ?? []).filter((x) => matches(x, f)).length;

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={!ws}>
            {t('action.createTask')}
          </Button>
        }
      />
      {(approvals.data ?? []).length ? (
        <Card title={t('home.pendingApprovals')} icon="shield" count={approvals.data!.length} style={{ marginBottom: 24 }}>
          <div className="cd-grid cd-grid--2">{approvals.data!.map((a) => <ApprovalItem key={a.id} approval={a} />)}</div>
        </Card>
      ) : null}
      <div style={{ marginBottom: 16 }}>
        <Tabs
          value={filter}
          onChange={(id) => setFilter(id as Filter)}
          items={[
            { id: 'all', label: t('tasks.filter.all'), count: count('all') },
            { id: 'active', label: t('tasks.filter.active'), count: count('active') },
            { id: 'waiting', label: t('tasks.filter.waiting'), count: count('waiting') },
            { id: 'done', label: t('tasks.filter.done'), count: count('done') },
          ]}
        />
      </div>
      {list.length ? (
        <div className="cd-stack">
          {list.map((task, i) => {
            const st = taskTone(task.status);
            const taskSessions = (sessions.data ?? []).filter((s) => s.taskId === task.id);
            return (
              <div key={task.id}>
                <TaskRow ticket={task.ticketKey ?? '—'} title={task.title} repos={repoNames(task.repositoryIds)} progress={task.progress} tone={st.tone} statusLabel={t(st.key)} index={i} selected={task.id === selected} onClick={() => setSelected(task.id === selected ? null : task.id)} />
                {task.id === selected && selectedTask ? (
                  <Card compact style={{ marginTop: 8, animation: 'none' }}>
                    {selectedTask.objective ? <p style={{ margin: '0 0 12px' }} className="cd-muted">{selectedTask.objective}</p> : null}
                    <div className="cd-row-gap">
                      {taskSessions.map((s) => (
                        <Button key={s.id} variant="secondary" size="sm" icon="session" onClick={() => openSession(s.id)}>
                          {t(`provider.${s.provider}`)} · {t(`role.${s.role}`)}
                        </Button>
                      ))}
                      {task.status === 'draft' || task.status === 'failed' ? (
                        <Button variant="primary" size="sm" icon="play" loading={start.isPending} onClick={() => start.mutate(task.id)}>
                          {t('action.start')}
                        </Button>
                      ) : null}
                      {['running', 'waiting_approval', 'queued', 'paused', 'review'].includes(task.status) ? (
                        <Button variant="ghost" size="sm" icon="stop" loading={cancel.isPending} onClick={() => cancel.mutate(task.id)}>
                          {t('action.cancel')}
                        </Button>
                      ) : null}
                      <span className="cd-body-sm cd-muted">{taskSessions.length > 1 ? t('tasks.agents.plural', { n: taskSessions.length }) : t('tasks.agents', { n: taskSessions.length })}</span>
                    </div>
                  </Card>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="tasks" title={t('tasks.empty')} body={ws ? undefined : t('workspaces.empty')} />
      )}
      <CreateTaskDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
