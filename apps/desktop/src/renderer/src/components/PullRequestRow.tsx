import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CICheck, PullRequest } from '@codeo/domain';
import type { MessageKey } from '@codeo/i18n';
import { Banner, Button, StatusPill, type Tone } from '@codeo/ui-desktop';
import { codeo, describeError, invoke } from '../lib/api';
import { formatRelative, useT } from '../lib/i18n';

export const PR_TONE: Record<PullRequest['status'], Tone> = {
  draft: 'idle',
  open: 'live',
  changes_requested: 'attention',
  approved: 'done',
  merged: 'done',
  closed: 'idle',
};

export function checksSummary(checks: CICheck[]): { tone: Tone; key: MessageKey; n: number } | null {
  if (!checks.length) return null;
  const failed = checks.filter((c) => c.status === 'failure').length;
  if (failed) return { tone: 'error', key: 'pr.checks.failed', n: failed };
  const pending = checks.filter((c) => c.status === 'queued' || c.status === 'running').length;
  if (pending) return { tone: 'waiting', key: 'pr.checks.pending', n: pending };
  return { tone: 'done', key: 'pr.checks.passed', n: checks.length };
}

/** `#12, #14` — the pull requests of a task, for a compact badge. */
export const prNumbers = (prs: PullRequest[]) => prs.map((p) => `#${p.number}`).join(', ');

/**
 * One pull request: number, status, CI summary, the PRs it depends on (looked up in `all`), when it was last read
 * from GitHub, a link to it and a refresh from the code host.
 */
export function PullRequestRow({ pr, context, all = [] }: { pr: PullRequest; context?: string | undefined; all?: PullRequest[] }) {
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
  const deps = all.filter((p) => pr.dependsOn.includes(p.id));
  return (
    <div className="cd-stack cd-stack--sm">
      <div className="cd-list-row" style={{ cursor: 'default' }}>
        <StatusPill tone={PR_TONE[pr.status]}>{t(`pr.status.${pr.status}`)}</StatusPill>
        <span className="cd-list-row__title">
          <span style={{ color: 'var(--ink)' }}>#{pr.number} {pr.title}</span>
          {context ? ` · ${context}` : ''}
          <span className="cd-key"> · {pr.branch} → {pr.baseBranch}</span>
        </span>
        {/* One grid cell (the row has four columns), outside the truncated title so the dependency stays readable. */}
        <span className="cd-row-gap" style={{ whiteSpace: 'nowrap' }}>
          {deps.length ? <span className="cd-key">{t('pr.dependsOn', { numbers: prNumbers(deps) })}</span> : null}
          {pr.syncedAt ? <span className="cd-list-row__time">{t('pr.syncedAgo', { ago: formatRelative(t, pr.syncedAt) })}</span> : null}
          {checks ? <StatusPill tone={checks.tone}>{t(checks.key, { n: checks.n })}</StatusPill> : <span className="cd-key">{t('pr.checks.none')}</span>}
        </span>
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
