import { useState } from 'react';
import type { GitHubIssue, RepositoryIssues } from '@codeo/contracts';
import type { Task } from '@codeo/domain';
import { Banner, Button, Card, Icon, Overline, PageHeader, Placeholder, StatusPill } from '@codeo/ui-desktop';
import { CreateTaskDialog } from '../components/CreateTaskDialog';
import { taskTone } from '../components/status';
import { codeo, describeError } from '../lib/api';
import { useT } from '../lib/i18n';
import { useGitHubIssues, useTasks } from '../lib/queries';
import { useUi } from '../lib/store';

type Column = 'backlog' | 'in_progress' | 'review' | 'pr_open' | 'done';
const columnOf = (task: Task): Column =>
  task.status === 'draft' || task.status === 'queued' ? 'backlog' : task.status === 'review' ? 'review' : task.status === 'completed' ? 'done' : ['cancelled', 'failed'].includes(task.status) ? 'backlog' : 'in_progress';

/**
 * Open GitHub issues of the workspace's repositories (read live with `gh`), each one a task away, above a kanban
 * over tasks. Columns are derived from task status so nothing here can perform a hidden action; Jira comes later.
 */
export function TicketsScreen() {
  const t = useT();
  const { workspaceId, navigate } = useUi();
  const tasks = useTasks(workspaceId);
  const issues = useGitHubIssues(workspaceId);
  const [fromIssue, setFromIssue] = useState<GitHubIssue | null>(null);
  const issueCount = (issues.data ?? []).reduce((n, r) => n + r.issues.length, 0);
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
      {workspaceId ? (
        <Card title={t('tickets.github.title')} icon="ticket" count={issues.data ? issueCount : undefined} action={{ label: t('action.refresh'), onClick: () => void issues.refetch() }} style={{ marginBottom: 24 }}>
          {issues.isLoading ? <span className="cd-body-sm cd-muted">{t('tickets.github.loading')}</span> : null}
          {issues.error ? <Banner tone="error">{describeError(issues.error, t)}</Banner> : null}
          <div className="cd-stack">
            {(issues.data ?? []).map((repo) => (
              <RepositoryIssueList key={repo.repositoryId} repo={repo} showName={(issues.data ?? []).length > 1} onCreate={setFromIssue} onView={() => navigate('tasks')} />
            ))}
          </div>
        </Card>
      ) : null}
      <div style={{ marginBottom: 16 }}>
        <Banner tone="info">
          {t('tickets.placeholder')} <Placeholder>{t('tasks.create.source.jira')} · {t('placeholder.phase', { n: 5 })}</Placeholder>
        </Banner>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Overline>{t('tickets.tasks')}</Overline>
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
      <CreateTaskDialog open={fromIssue !== null} issue={fromIssue} onClose={() => setFromIssue(null)} />
    </>
  );
}

function RepositoryIssueList({ repo, showName, onCreate, onView }: { repo: RepositoryIssues; showName: boolean; onCreate: (issue: GitHubIssue) => void; onView: () => void }) {
  const t = useT();
  return (
    <div className="cd-stack cd-stack--sm">
      {showName ? (
        <Overline>
          <Icon name="folder" size={12} /> {repo.repositoryName}
        </Overline>
      ) : null}
      {repo.error ? (
        <Banner tone="warn">
          {t('tickets.github.unavailable', { repo: repo.repositoryName })} <span className="cd-key">{repo.error}</span>
        </Banner>
      ) : repo.issues.length === 0 ? (
        <span className="cd-body-sm cd-muted">{t('tickets.github.empty')}</span>
      ) : (
        repo.issues.map((issue) => (
          <div key={issue.number} className="cd-issue">
            <span className="cd-key">{issue.key}</span>
            <span className="cd-issue__main">
              <span className="cd-issue__title">{issue.title}</span>
              {issue.labels.length || issue.author ? (
                <span className="cd-row-gap">
                  {issue.labels.map((l) => (
                    <span key={l} className="cd-issue__label">
                      {l}
                    </span>
                  ))}
                  {issue.author ? <span className="cd-body-sm cd-muted">@{issue.author}</span> : null}
                </span>
              ) : null}
            </span>
            <span className="cd-row-gap cd-issue__actions">
              <Button variant="ghost" size="sm" icon="external" onClick={() => void codeo.openExternal(issue.url)}>
                {t('pr.openOnGitHub')}
              </Button>
              {issue.taskId ? (
                <Button variant="secondary" size="sm" icon="tasks" onClick={onView}>
                  {t('tickets.github.viewTask')}
                </Button>
              ) : (
                <Button variant="primary" size="sm" icon="plus" onClick={() => onCreate(issue)}>
                  {t('tickets.github.createTask')}
                </Button>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
