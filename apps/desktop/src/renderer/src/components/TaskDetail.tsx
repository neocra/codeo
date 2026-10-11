import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { orderedSubtasks, type Task, type Worktree } from '@codeo/domain';
import { Banner, Button, Card, Icon, StatusPill } from '@codeo/ui-desktop';
import { invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { useWorktrees } from '../lib/queries';
import { useUi } from '../lib/store';
import { subtaskTone } from './status';

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['tasks'] });
  void qc.invalidateQueries({ queryKey: ['home'] });
};

/** Expanded task: its plan of agents, where each one works, and the task controls. */
export function TaskDetail({ task }: { task: Task }) {
  const t = useT();
  const qc = useQueryClient();
  const openSession = useUi((s) => s.openSession);
  const worktrees = useWorktrees(task.id);
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const onSettled = () => invalidate(qc);
  const start = useMutation({ mutationFn: () => invoke('tasks.start', { taskId: task.id }), onSuccess: ({ sessions }) => sessions[0] && openSession(sessions[0].id), onError, onSettled });
  const pause = useMutation({ mutationFn: () => invoke('tasks.pause', { taskId: task.id }), onError, onSettled });
  const resume = useMutation({ mutationFn: () => invoke('tasks.resume', { taskId: task.id }), onError, onSettled });
  const cancel = useMutation({ mutationFn: () => invoke('tasks.cancel', { taskId: task.id }), onError, onSettled });
  const subtasks = orderedSubtasks(task);
  const titleOf = (id: string) => task.subtasks.find((s) => s.id === id)?.title ?? id;
  const wtById = new Map((worktrees.data ?? []).map((w) => [w.id, w]));

  return (
    <Card compact style={{ marginTop: 8, animation: 'none' }}>
      <div className="cd-stack">
        {task.objective ? <p style={{ margin: 0 }} className="cd-muted">{task.objective}</p> : null}
        <div className="cd-row-gap cd-body-sm cd-muted">
          <Icon name="layers" size={14} />
          <span>{t(`tasks.mode.${task.orchestration}`)}</span>
          <span>·</span>
          <Icon name="branch" size={14} />
          <span>{t(`tasks.isolation.${task.isolation}`)}</span>
        </div>

        <div className="cd-overline">{t('tasks.subtasks')}</div>
        <div className="cd-list">
          {subtasks.map((s) => {
            const st = subtaskTone(s.status);
            const wt = s.worktreeId ? wtById.get(s.worktreeId) : undefined;
            const open = s.sessionId ? () => openSession(s.sessionId!) : undefined;
            return (
              <div key={s.id} className="cd-list-row" role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open?.()} style={open ? undefined : { cursor: 'default' }}>
                <StatusPill key={st.tone} tone={st.tone}>
                  {t(st.key)}
                </StatusPill>
                <span className="cd-list-row__title">
                  <span style={{ color: 'var(--ink)' }}>{s.title}</span> · {t(`provider.${s.assignment.provider}`)} · {t(`role.${s.assignment.role}`)}
                  {s.dependsOn.length ? ` · ${t('tasks.subtask.waitsFor', { list: s.dependsOn.map(titleOf).join(', ') })}` : ''}
                </span>
                <span className="cd-key">{wt ? wt.branch : task.isolation === 'none' ? t('tasks.subtask.inRepository') : '—'}</span>
                {open ? <Icon name="chevron" size={14} /> : <span />}
              </div>
            );
          })}
        </div>

        {(worktrees.data ?? []).length ? (
          <div className="cd-stack cd-stack--sm">
            {(worktrees.data ?? []).map((w) => (
              <WorktreeRow key={w.id} worktree={w} busy={['running', 'waiting_approval', 'queued'].includes(task.status)} />
            ))}
          </div>
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}
        <div className="cd-row-gap">
          {task.status === 'draft' || task.status === 'failed' ? (
            <Button variant="primary" size="sm" icon="play" loading={start.isPending} onClick={() => start.mutate()}>
              {task.status === 'failed' ? t('action.retry') : t('action.start')}
            </Button>
          ) : null}
          {['running', 'waiting_approval', 'queued'].includes(task.status) ? (
            <Button variant="secondary" size="sm" icon="stop" loading={pause.isPending} onClick={() => pause.mutate()}>
              {t('action.pause')}
            </Button>
          ) : null}
          {task.status === 'paused' ? (
            <Button variant="primary" size="sm" icon="play" loading={resume.isPending} onClick={() => resume.mutate()}>
              {t('action.resume')}
            </Button>
          ) : null}
          {['running', 'waiting_approval', 'queued', 'paused', 'review'].includes(task.status) ? (
            <Button variant="ghost" size="sm" icon="x" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('action.cancel')}
            </Button>
          ) : null}
          <span className="cd-body-sm cd-muted">{task.subtasks.length > 1 ? t('tasks.agents.plural', { n: task.subtasks.length }) : t('tasks.agents', { n: task.subtasks.length })}</span>
        </div>
      </div>
    </Card>
  );
}

/** A worktree with its removal flow: a dirty one needs an explicit second confirmation. */
function WorktreeRow({ worktree, busy }: { worktree: Worktree; busy: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (force: boolean) => invoke('worktrees.remove', { worktreeId: worktree.id, force }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['worktrees'] }),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="cd-stack cd-stack--sm">
      <div className="cd-row-gap cd-body-sm">
        <Icon name="folder" size={14} />
        <span className="cd-key" title={worktree.path}>
          {worktree.branch}
        </span>
        {worktree.dirty ? <StatusPill tone="attention">{t('tasks.worktree.dirty')}</StatusPill> : null}
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          disabled={busy}
          title={t('tasks.worktree.removedHint', { branch: worktree.branch })}
          loading={remove.isPending && !confirming}
          onClick={() => {
            setError(null);
            if (worktree.dirty) setConfirming(true);
            else remove.mutate(false);
          }}
        >
          {t('tasks.worktree.remove')}
        </Button>
      </div>
      {confirming ? (
        <Banner tone="warn">
          {t('tasks.worktree.confirmForce')}{' '}
          <Button variant="secondary" size="sm" loading={remove.isPending} onClick={() => remove.mutate(true)}>
            {t('tasks.worktree.forceRemove')}
          </Button>{' '}
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            {t('action.cancel')}
          </Button>
        </Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </div>
  );
}
