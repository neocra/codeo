import type { Task } from '@codeo/domain';
import { Banner, Button, Icon, PageHeader, Placeholder, StatusPill } from '@codeo/ui-desktop';
import { taskTone } from '../components/status';
import { useT } from '../lib/i18n';
import { useTasks } from '../lib/queries';
import { useUi } from '../lib/store';

type Column = 'backlog' | 'in_progress' | 'review' | 'pr_open' | 'done';
const columnOf = (task: Task): Column =>
  task.status === 'draft' || task.status === 'queued' ? 'backlog' : task.status === 'review' ? 'review' : task.status === 'completed' ? 'done' : ['cancelled', 'failed'].includes(task.status) ? 'backlog' : 'in_progress';

/**
 * Kanban over tasks. Ticket providers (Jira / GitHub) and drag-and-drop lifecycle moves arrive in
 * phase 5 — columns are derived from task status so nothing here can perform a hidden action.
 */
export function TicketsScreen() {
  const t = useT();
  const { workspaceId, navigate } = useUi();
  const tasks = useTasks(workspaceId);
  const columns: { id: Column; label: string }[] = [
    { id: 'backlog', label: t('tickets.column.backlog') },
    { id: 'in_progress', label: t('tickets.column.inProgress') },
    { id: 'review', label: t('tickets.column.review') },
    { id: 'pr_open', label: t('tickets.column.prOpen') },
    { id: 'done', label: t('tickets.column.done') },
  ];
  return (
    <>
      <PageHeader
        title={t('tickets.title')}
        subtitle={t('tickets.subtitle')}
        actions={
          <Button variant="secondary" icon="tasks" onClick={() => navigate('tasks')}>
            {t('nav.tasks')}
          </Button>
        }
      />
      <div style={{ marginBottom: 16 }}>
        <Banner tone="info">
          {t('tickets.placeholder')} <Placeholder>{t('placeholder.phase', { n: 5 })}</Placeholder>
        </Banner>
      </div>
      <div className="cd-kanban">
        {columns.map((col) => {
          const items = (tasks.data ?? []).filter((x) => columnOf(x) === col.id);
          return (
            <div key={col.id} className="cd-kanban__col">
              <div className="cd-kanban__head">
                {col.label} <span className="cd-key">{items.length}</span>
              </div>
              {items.map((task) => {
                const st = taskTone(task.status);
                return (
                  <div key={task.id} className="cd-kanban__card" role="button" tabIndex={0} onClick={() => navigate('tasks')} onKeyDown={(e) => e.key === 'Enter' && navigate('tasks')}>
                    <span className="cd-key">{task.ticketKey ?? '—'}</span>
                    <span style={{ fontWeight: 500 }}>{task.title}</span>
                    <span className="cd-row-gap">
                      <Icon name="branch" size={12} />
                      <span className="cd-body-sm cd-muted">{task.repositoryIds.length}</span>
                      <StatusPill key={task.status} tone={st.tone}>
                        {t(st.key)}
                      </StatusPill>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
