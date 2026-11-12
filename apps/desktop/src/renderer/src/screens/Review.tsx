import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FileDiff } from '@codeo/contracts';
import { orderedSubtasks, type CICheck, type PullRequest, type Subtask, type Task, type Worktree } from '@codeo/domain';
import type { MessageKey } from '@codeo/i18n';
import { Banner, Button, Card, Choice, DiffView, EmptyState, Field, Icon, Input, PageHeader, StatusPill, Tabs, TaskRow, Textarea, type DiffLine, type Tone } from '@codeo/ui-desktop';
import { taskTone } from '../components/status';
import { codeo, describeError, invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { useGitHubStatus, useTaskPullRequests, useTasks, useWorkspacePullRequests, useWorkspaces, useWorktreeDiff, useWorktrees } from '../lib/queries';
import { useUi } from '../lib/store';

/** Files are expanded by default only while the whole diff stays readable at a glance. */
const AUTO_EXPAND_LINES = 1500;

/** Human review of what the agents produced: real diffs of each worktree against its base branch, then completion. */
export function ReviewScreen() {
  const t = useT();
  const { workspaceId, reviewTaskId, openReview } = useUi();
  const tasks = useTasks(workspaceId);
  const ws = useWorkspaces().data?.find((w) => w.id === workspaceId);
  const all = tasks.data ?? [];
  const inReview = all.filter((x) => x.status === 'review');
  /* Completed tasks stay reachable so their pull request can be opened or followed. */
  const completed = all.filter((x) => x.status === 'completed' && x.isolation === 'worktree').slice(0, 10);
  /* A task just completed from this screen stays visible so its outcome can be read. */
  const pinned = reviewTaskId ? all.find((x) => x.id === reviewTaskId) : undefined;
  const open = pinned && !inReview.includes(pinned) && !completed.includes(pinned) ? [pinned, ...inReview] : inReview;
  const list = [...open, ...completed.filter((x) => !open.includes(x))];
  const selected = pinned ?? inReview[0] ?? list[0] ?? null;
  const repoNames = (ids: string[]) => (ws?.repositories ?? []).filter((r) => ids.includes(r.id)).map((r) => r.name);

  return (
    <>
      <PageHeader title={t('review.title')} subtitle={t('review.subtitle')} />
      {list.length ? (
        <div className="cd-stack">
          {list.map((task, i) => {
            const st = taskTone(task.status);
            return (
              <TaskRow
                key={task.id}
                ticket={task.ticketKey ?? '—'}
                title={task.title}
                repos={repoNames(task.repositoryIds)}
                progress={task.progress}
                tone={st.tone}
                statusLabel={t(st.key)}
                index={i}
                selected={task.id === selected?.id}
                onClick={() => openReview(task.id)}
              />
            );
          })}
          {selected ? <TaskReview key={selected.id} task={selected} /> : null}
        </div>
      ) : (
        <EmptyState icon="review" title={t('review.empty')} body={t('review.empty.body')} />
      )}
      <WorkspacePullRequests workspaceId={workspaceId} tasks={all} />
    </>
  );
}

function TaskReview({ task }: { task: Task }) {
  const t = useT();
  const qc = useQueryClient();
  const worktrees = useWorktrees(task.id);
  const [error, setError] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (winnerSubtaskId?: string) => invoke('tasks.complete', winnerSubtaskId ? { taskId: task.id, winnerSubtaskId } : { taskId: task.id }),
    onMutate: () => setError(null),
    onError: (e) => setError(describeError(e, t)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
  const lanes = worktrees.data ?? [];
  const bestOfN = task.orchestration === 'best-of-n';
  const candidates = orderedSubtasks(task).filter((s) => s.status === 'completed');
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const candidate = candidates.find((s) => s.id === candidateId) ?? candidates[0] ?? null;
  const laneOf = (s: Subtask) => lanes.find((w) => w.id === s.worktreeId);
  const inReview = task.status === 'review';
  const winner = task.winnerSubtaskId ? task.subtasks.find((s) => s.id === task.winnerSubtaskId) : undefined;

  /* Shared lanes (single, sequential, pipeline) hold every step's work; parallel lanes belong to one subtask each. */
  const laneTitle = (w: Worktree) => (w.subtaskId ? task.subtasks.find((s) => s.id === w.subtaskId)?.title : undefined) ?? task.title;

  return (
    <Card compact style={{ animation: 'none' }}>
      <div className="cd-stack">
        {task.status === 'completed' ? (
          <Banner tone="info">{winner ? t('review.completedWinner', { title: winner.title }) : t('review.completed')}</Banner>
        ) : null}

        {task.isolation === 'none' ? (
          <Banner tone="info">{t('review.noIsolation')}</Banner>
        ) : worktrees.isSuccess && !lanes.length ? (
          <Banner tone="warn">{t('review.noWorktree')}</Banner>
        ) : null}

        {bestOfN && task.isolation === 'worktree' ? (
          <>
            <div className="cd-overline">{t('review.candidates', { n: candidates.length, total: task.subtasks.length })}</div>
            {candidates.length ? (
              <Tabs
                variant="underline"
                value={candidate?.id}
                onChange={setCandidateId}
                items={candidates.map((s) => ({ id: s.id, label: `${s.title} · ${t(`provider.${s.assignment.provider}`)}` }))}
              />
            ) : null}
            {candidate ? (
              (() => {
                const lane = laneOf(candidate);
                return lane ? <LaneDiff taskId={task.id} worktree={lane} title={candidate.title} /> : worktrees.isSuccess ? <Banner tone="warn">{t('review.candidateNoWorktree')}</Banner> : null;
              })()
            ) : null}
          </>
        ) : (
          lanes.map((w) => <LaneDiff key={w.id} taskId={task.id} worktree={w} title={laneTitle(w)} />)
        )}

        {error ? <Banner tone="error">{error}</Banner> : null}
        <div className="cd-row-gap">
          {inReview && bestOfN ? (
            <Button variant="approve" size="sm" icon="check" disabled={!candidate} loading={complete.isPending} onClick={() => candidate && complete.mutate(candidate.id)}>
              {t('review.keepCandidate')}
            </Button>
          ) : null}
          {inReview && !bestOfN ? (
            <Button variant="approve" size="sm" icon="check" loading={complete.isPending} onClick={() => complete.mutate(undefined)}>
              {t('review.complete')}
            </Button>
          ) : null}
          {inReview && task.isolation === 'worktree' ? <span className="cd-body-sm cd-muted">{t('pr.afterReview')}</span> : null}
        </div>
        {task.status === 'completed' && task.isolation === 'worktree' && lanes.length ? <PublishPanel task={task} /> : null}
      </div>
    </Card>
  );
}

const PR_TONE: Record<PullRequest['status'], Tone> = {
  draft: 'idle',
  open: 'live',
  changes_requested: 'attention',
  approved: 'done',
  merged: 'done',
  closed: 'idle',
};

function checksSummary(checks: CICheck[]): { tone: Tone; key: MessageKey; n: number } | null {
  if (!checks.length) return null;
  const failed = checks.filter((c) => c.status === 'failure').length;
  if (failed) return { tone: 'error', key: 'pr.checks.failed', n: failed };
  const pending = checks.filter((c) => c.status === 'queued' || c.status === 'running').length;
  if (pending) return { tone: 'waiting', key: 'pr.checks.pending', n: pending };
  return { tone: 'done', key: 'pr.checks.passed', n: checks.length };
}

/** One pull request: number, status, CI summary, link to GitHub and a refresh from the code host. */
function PullRequestRow({ pr, context }: { pr: PullRequest; context?: string | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => invoke('pullRequests.refresh', { pullRequestId: pr.id }),
    onMutate: () => setError(null),
    onError: (e) => setError(describeError(e, t)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['pullRequests'] }),
  });
  const checks = checksSummary(pr.checks);
  return (
    <div className="cd-stack cd-stack--sm">
      <div className="cd-list-row" style={{ cursor: 'default' }}>
        <StatusPill tone={PR_TONE[pr.status]}>{t(`pr.status.${pr.status}`)}</StatusPill>
        <span className="cd-list-row__title">
          <span style={{ color: 'var(--ink)' }}>#{pr.number} {pr.title}</span>
          {context ? ` · ${context}` : ''}
          <span className="cd-key"> · {pr.branch} → {pr.baseBranch}</span>
        </span>
        {checks ? <StatusPill tone={checks.tone}>{t(checks.key, { n: checks.n })}</StatusPill> : <span className="cd-key">{t('pr.checks.none')}</span>}
        <span className="cd-row-gap">
          <Button variant="ghost" size="sm" icon="refresh" loading={refresh.isPending} onClick={() => refresh.mutate()}>
            {t('action.refresh')}
          </Button>
          <Button variant="ghost" size="sm" icon="external" onClick={() => void codeo.openExternal(pr.url)}>
            {t('pr.openOnGitHub')}
          </Button>
        </span>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
    </div>
  );
}

/** Completed task → pull request: commit the kept worktree(s), push the branch, open the PR with the user's gh. */
function PublishPanel({ task }: { task: Task }) {
  const t = useT();
  const qc = useQueryClient();
  const prs = useTaskPullRequests(task.id);
  const gh = useGitHubStatus();
  const [title, setTitle] = useState(() => (task.ticketKey ? `${task.ticketKey}: ${task.title}` : task.title).slice(0, 72));
  const [body, setBody] = useState(task.objective);
  const [draft, setDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const publish = useMutation({
    mutationFn: () => invoke('pullRequests.create', { taskId: task.id, title, body, draft }),
    onMutate: () => {
      setError(null);
      setSkipped(0);
    },
    onSuccess: (r) => setSkipped(r.skipped.length),
    onError: (e) => setError(describeError(e, t)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['pullRequests'] });
      void qc.invalidateQueries({ queryKey: ['worktrees', task.id] });
    },
  });
  const existing = prs.data ?? [];
  const ghProblem = gh.data && !gh.data.installed ? t('pr.ghMissing') : gh.data && !gh.data.authenticated ? t('pr.ghUnauthenticated') : null;

  return (
    <div className="cd-stack cd-stack--sm">
      <div className="cd-overline">{t('pr.title')}</div>
      {existing.map((pr) => (
        <PullRequestRow key={pr.id} pr={pr} />
      ))}
      {ghProblem ? <Banner tone="warn">{ghProblem}</Banner> : null}
      {!existing.length ? (
        <>
          <p className="cd-body-sm cd-muted" style={{ margin: 0 }}>
            {task.orchestration === 'best-of-n' ? t('pr.explainWinner') : t('pr.explain')}
          </p>
          <Field label={t('pr.field.title')} htmlFor={`pr-title-${task.id}`}>
            <Input id={`pr-title-${task.id}`} value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('pr.field.body')} htmlFor={`pr-body-${task.id}`}>
            <Textarea id={`pr-body-${task.id}`} value={body} rows={4} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Choice type="checkbox" checked={draft} onChange={() => setDraft((d) => !d)} label={t('pr.field.draft')} />
        </>
      ) : null}
      {skipped ? <Banner tone="info">{t('pr.skipped', { n: skipped })}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="cd-row-gap">
        <Button variant="primary" size="sm" icon="branch" disabled={Boolean(ghProblem) || !title.trim()} loading={publish.isPending} onClick={() => publish.mutate()}>
          {existing.length ? t('pr.update') : t('pr.create')}
        </Button>
        {existing.length ? <span className="cd-body-sm cd-muted">{t('pr.updateHint')}</span> : null}
      </div>
    </div>
  );
}

/** Every pull request opened from this workspace's tasks, newest first. */
function WorkspacePullRequests({ workspaceId, tasks }: { workspaceId: string | null; tasks: Task[] }) {
  const t = useT();
  const prs = useWorkspacePullRequests(workspaceId);
  const list = prs.data ?? [];
  if (!list.length) return null;
  const taskTitle = (id: string | null) => tasks.find((x) => x.id === id)?.title;
  return (
    <Card title={t('pr.all')} icon="branch" count={list.length} style={{ marginTop: 24 }}>
      <div className="cd-stack cd-stack--sm">
        {list.map((pr) => (
          <PullRequestRow key={pr.id} pr={pr} context={taskTitle(pr.taskId)} />
        ))}
      </div>
    </Card>
  );
}

function LaneDiff({ taskId, worktree, title }: { taskId: string; worktree: Worktree; title: string }) {
  const t = useT();
  const diff = useWorktreeDiff(taskId, worktree.id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const data = diff.data;
  const autoExpand = data ? data.additions + data.deletions <= AUTO_EXPAND_LINES : false;
  const isOpen = (f: FileDiff) => expanded[f.path] ?? autoExpand;

  return (
    <div className="cd-stack cd-stack--sm">
      <div className="cd-row-gap cd-body-sm">
        <Icon name="branch" size={14} />
        <span style={{ color: 'var(--ink)' }}>{title}</span>
        <span className="cd-key" title={worktree.path}>
          {worktree.branch} ← {worktree.baseBranch}
        </span>
        {data ? (
          <>
            <span className="cd-key">{data.files.length === 1 ? t('review.files.one') : t('review.files', { n: data.files.length })}</span>
            <span className="cd-diff__plus">+{data.additions}</span>
            <span className="cd-diff__minus">−{data.deletions}</span>
            {data.commits ? <span className="cd-key">{t('review.commits', { n: data.commits })}</span> : null}
            {data.uncommitted ? <StatusPill tone="attention">{t('review.uncommitted')}</StatusPill> : null}
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="refresh" loading={diff.isFetching} onClick={() => void diff.refetch()}>
          {t('action.refresh')}
        </Button>
      </div>
      {diff.isError ? <Banner tone="error">{describeError(diff.error, t)}</Banner> : null}
      {data?.truncated ? <Banner tone="warn">{t('review.truncated')}</Banner> : null}
      {data && !data.files.length ? <p className="cd-body-sm cd-muted" style={{ margin: 0 }}>{t('review.noChanges')}</p> : null}
      {data?.files.map((f) => (
        <div key={f.path} className="cd-stack cd-stack--sm">
          <div
            className="cd-list-row"
            role="button"
            tabIndex={0}
            aria-expanded={isOpen(f)}
            onClick={() => setExpanded((e) => ({ ...e, [f.path]: !isOpen(f) }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded((x) => ({ ...x, [f.path]: !isOpen(f) }));
              }
            }}
          >
            <StatusPill tone={f.status === 'deleted' ? 'error' : f.status === 'added' ? 'done' : 'idle'}>{t(`review.status.${f.status}`)}</StatusPill>
            <span className="cd-list-row__title cd-key">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
            <span className="cd-key">
              <span className="cd-diff__plus">+{f.additions}</span> <span className="cd-diff__minus">−{f.deletions}</span>
            </span>
            <Icon name="chevron" size={14} style={{ transform: isOpen(f) ? 'rotate(90deg)' : undefined }} />
          </div>
          {isOpen(f) ? (
            f.binary ? (
              <p className="cd-body-sm cd-muted" style={{ margin: 0 }}>{t('review.binary')}</p>
            ) : f.hunks.length ? (
              <DiffView file={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path} lines={toLines(f)} additions={f.additions} deletions={f.deletions} />
            ) : (
              <p className="cd-body-sm cd-muted" style={{ margin: 0 }}>{t('review.noContentChange')}</p>
            )
          ) : null}
          {isOpen(f) && f.truncated ? <p className="cd-body-sm cd-muted" style={{ margin: 0 }}>{t('review.fileTruncated')}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** Hunks flattened for DiffView; each hunk header becomes an unnumbered context line separating the hunks. */
function toLines(f: FileDiff): DiffLine[] {
  const out: DiffLine[] = [];
  for (const h of f.hunks) {
    out.push({ type: 'ctx', text: h.header });
    for (const l of h.lines) out.push({ type: l.type, ...(l.old !== null ? { old: l.old } : {}), ...(l.new !== null ? { new: l.new } : {}), text: l.text });
  }
  return out;
}
