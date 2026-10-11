import { useState } from 'react';
import type { Task } from '@codeo/domain';
import { Button, Card, EmptyState, PageHeader, Tabs, TaskRow } from '@codeo/ui-desktop';
import { ApprovalItem } from '../components/ApprovalItem';
import { CreateTaskDialog } from '../components/CreateTaskDialog';
import { TaskDetail } from '../components/TaskDetail';
import { taskTone } from '../components/status';
import { useT } from '../lib/i18n';
import { usePendingApprovals, useTasks, useWorkspaces } from '../lib/queries';
import { useUi } from '../lib/store';

type Filter = 'all' | 'active' | 'waiting' | 'done';
const matches = (t: Task, f: Filter) =>
  f === 'all' ? true : f === 'active' ? ['running', 'queued', 'review'].includes(t.status) : f === 'waiting' ? ['waiting_approval', 'paused', 'draft'].includes(t.status) : ['completed', 'failed', 'cancelled'].includes(t.status);

export function TasksScreen() {
  const t = useT();
  const { workspaceId } = useUi();
  const tasks = useTasks(workspaceId);
  const approvals = usePendingApprovals();
  const workspaces = useWorkspaces();
  const ws = workspaces.data?.find((w) => w.id === workspaceId);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = (tasks.data ?? []).filter((x) => matches(x, filter));
  const selectedTask = (tasks.data ?? []).find((x) => x.id === selected) ?? null;
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
            return (
              <div key={task.id}>
                <TaskRow ticket={task.ticketKey ?? '—'} title={task.title} repos={repoNames(task.repositoryIds)} progress={task.progress} tone={st.tone} statusLabel={t(st.key)} index={i} selected={task.id === selected} onClick={() => setSelected(task.id === selected ? null : task.id)} />
                {task.id === selected && selectedTask ? <TaskDetail task={selectedTask} /> : null}
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
