import { existsSync } from 'node:fs';
import { localizedError, RuntimeError, type CommandParsedParams } from '@codeo/contracts';
import type { PullRequestRepo } from '@codeo/database';
import { orderedSubtasks, type PullRequest, type Task, type Worktree } from '@codeo/domain';
import { commitAll, commitsAhead, pushBranch, resolveCommit } from '@codeo/git';
import { newId, type KeyedLock, type Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';
import { GhError, type GitHubClient, type RemotePullRequest } from '../github/gh-cli';
import { laneKey } from './sessions';
import type { TaskService } from './tasks';
import type { WorkspaceService } from './workspaces';
import type { WorktreeService } from './worktrees';

/** Statuses GitHub can still change: these pull requests are refreshed in the background. */
const ACTIVE: ReadonlySet<PullRequest['status']> = new Set(['draft', 'open', 'changes_requested', 'approved']);

/** What a background refresh compares: a change here is announced, a mere new `syncedAt` is not. */
const snapshot = (pr: PullRequest) =>
  JSON.stringify([pr.status, pr.title, pr.number, pr.branch, pr.baseBranch, pr.additions, pr.deletions, pr.checks, pr.dependsOn]);

/** Removes a merged lane's worktree the safe way (clean only, no agent at work); resolves to why it was kept, or null. */
export type MergedLaneCleanup = (worktreeId: string) => Promise<string | null>;

const reason = (err: unknown) => (err instanceof GhError ? err.stderr || err.message : err instanceof Error ? err.message : String(err));

/** `origin/main` → `main`: a pull request targets a branch of the remote, never a remote-tracking ref. */
const remoteBranch = (ref: string) => ref.replace(/^origin\//, '');

/** Commit and PR text written for the task (title line ≤ 72 chars, objective as the body). */
export function defaultPullRequestText(task: Task): { title: string; body: string } {
  const title = (task.ticketKey ? `${task.ticketKey}: ${task.title}` : task.title).slice(0, 72);
  const agents = orderedSubtasks(task)
    .filter((s) => s.status === 'completed')
    .map((s) => `- ${s.title} (${s.assignment.provider}, ${s.assignment.role})`);
  const body = [task.objective.trim(), agents.length ? `Agents :\n${agents.join('\n')}` : '', 'Créée avec Codeo.']
    .filter(Boolean)
    .join('\n\n');
  return { title, body };
}

/**
 * Turns a reviewed task into pull requests: each kept worktree's work is committed on its `codeo/…` branch,
 * the branch is pushed (never forced) and a PR is opened with the user's `gh` — or the one already open for
 * that branch is adopted. Re-running is safe: nothing to commit, an up-to-date push, the same PR.
 */
/** Appends the PRs this one builds on to a new PR's description (GitHub links them both ways). */
function withDependencies(body: string, deps: PullRequest[]): string {
  if (!deps.length) return body;
  return `${body}\n\nDépend de :\n${deps.map((d) => `- ${d.url}`).join('\n')}`;
}

export class PullRequestService {
  constructor(
    private readonly repo: PullRequestRepo,
    private readonly tasks: TaskService,
    private readonly worktrees: WorktreeService,
    private readonly workspaces: WorkspaceService,
    private readonly github: GitHubClient,
    private readonly bus: EventBus,
    private readonly log: Logger,
    /** Same lock as agents launched in a worktree: a commit never races a session in the same directory. */
    private readonly worktreeLocks: KeyedLock,
  ) {}

  /** Wired by the runtime: the same guarded removal as `worktrees.remove`, never forced. */
  cleanupMergedLane: MergedLaneCleanup | null = null;
  /** Worktrees already reported as kept after a merge (logged once, retried on every pass). */
  private readonly keptAfterMerge = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private pass: Promise<unknown> | null = null;
  private stopped = false;

  list(filter: { workspaceId?: string | undefined; taskId?: string | undefined }): Promise<PullRequest[]> {
    return this.repo.list(filter);
  }

  async get(id: string): Promise<PullRequest> {
    const pr = await this.repo.get(id);
    if (!pr) throw localizedError('NOT_FOUND', 'pr.notFound', { id }, `Pull request introuvable : ${id}`);
    return pr;
  }

  status() {
    return this.github.status();
  }

  /** The worktrees whose work goes into pull requests: Best-of-N keeps only the winner's. */
  private async lanes(task: Task): Promise<Worktree[]> {
    const all = await this.worktrees.list({ taskId: task.id });
    if (task.orchestration !== 'best-of-n') return all;
    const winner = task.subtasks.find((s) => s.id === task.winnerSubtaskId);
    return all.filter((w) => w.id === winner?.worktreeId || (w.subtaskId !== null && w.subtaskId === winner?.id));
  }

  private async assertGitHubReady(): Promise<void> {
    const st = await this.github.status();
    if (!st.installed)
      throw localizedError('PROVIDER_UNAVAILABLE', 'github.missing', undefined, 'GitHub CLI (gh) n’est pas installé : installez-le pour ouvrir des pull requests.');
    if (!st.authenticated)
      throw localizedError('PROVIDER_UNAVAILABLE', 'github.unauthenticated', undefined, 'GitHub CLI n’est pas connecté : lancez `gh auth login` puis réessayez.');
  }

  async create(input: CommandParsedParams<'pullRequests.create'>): Promise<{ pullRequests: PullRequest[]; skipped: string[] }> {
    const task = await this.tasks.get(input.taskId);
    if (task.status !== 'completed')
      throw localizedError('CONFLICT', 'pr.taskNotCompleted', undefined, 'Validez la revue de la tâche avant d’ouvrir une pull request.');
    if (task.isolation === 'none')
      throw localizedError('CONFLICT', 'pr.noIsolation', undefined, 'Cette tâche a travaillé directement dans le dépôt : il n’y a pas de branche à publier.');
    const lanes = await this.lanes(task);
    if (!lanes.length)
      throw localizedError('CONFLICT', 'pr.noWorktree', undefined, 'Aucun worktree à publier pour cette tâche.');
    await this.assertGitHubReady();
    const text = defaultPullRequestText(task);
    const title = input.title?.trim() || text.title;
    const body = input.body?.trim() || text.body;
    const pullRequests: PullRequest[] = [];
    const skipped: string[] = [];
    /* Dependencies first (plan order), so a lane's PR can name the PRs it builds on. */
    const order = new Map(orderedSubtasks(task).map((st, i) => [st.id, i]));
    const rank = (w: Worktree) => (w.subtaskId !== null ? (order.get(w.subtaskId) ?? order.size) : -1);
    const ordered = [...lanes].sort((a, b) => rank(a) - rank(b));
    const byLane = new Map<string, PullRequest>();
    /* One lane at a time: a failure stops before touching the next repository, and a retry resumes where it stopped. */
    for (const lane of ordered) {
      const dependsOn = await this.laneDependencies(task, lane, ordered, byLane);
      const pr = await this.worktreeLocks.run(laneKey(lane.path), () => this.publishLane(task, lane, { title, body, draft: input.draft }, dependsOn));
      if (pr) {
        pullRequests.push(pr);
        byLane.set(lane.id, pr);
      } else skipped.push(lane.id);
    }
    return { pullRequests, skipped };
  }

  /**
   * The pull requests a parallel lane builds on: those of the lanes running the subtasks its own subtask
   * `dependsOn`. A dependency lane that published nothing (skipped) contributes no PR.
   */
  private async laneDependencies(task: Task, lane: Worktree, lanes: Worktree[], published: Map<string, PullRequest>): Promise<PullRequest[]> {
    const subtask = lane.subtaskId !== null ? task.subtasks.find((st) => st.id === lane.subtaskId) : undefined;
    if (!subtask?.dependsOn.length) return [];
    const deps: PullRequest[] = [];
    for (const other of lanes) {
      if (other.id === lane.id || other.subtaskId === null || !subtask.dependsOn.includes(other.subtaskId)) continue;
      const pr = published.get(other.id) ?? (await this.repo.findByWorktree(other.id));
      if (pr && !deps.some((d) => d.id === pr.id)) deps.push(pr);
    }
    return deps;
  }

  private async publishLane(
    task: Task,
    lane: Worktree,
    text: { title: string; body: string; draft: boolean },
    dependsOn: PullRequest[],
  ): Promise<PullRequest | null> {
    const existing = await this.repo.findByWorktree(lane.id);
    if (!existsSync(lane.path)) {
      if (existing) return this.sync(existing, lane.path, true);
      throw localizedError('CONFLICT', 'pr.worktreeMissing', { path: lane.path }, `Le worktree ${lane.path} n’existe plus : rien à publier.`);
    }
    const repository = (await this.workspaces.get(lane.workspaceId)).repositories.find((r) => r.id === lane.repositoryId);
    if (!repository) throw localizedError('NOT_FOUND', 'repo.notFound', { id: lane.repositoryId }, `Dépôt introuvable: ${lane.repositoryId}`);
    const base = remoteBranch(lane.baseBranch === 'HEAD' ? repository.defaultBranch : lane.baseBranch);
    if (!base || base === 'HEAD')
      throw localizedError('CONFLICT', 'pr.noBaseBranch', { repo: repository.name }, `Le dépôt ${repository.name} n’a pas de branche par défaut : impossible de cibler une pull request.`);

    try {
      const sha = await commitAll(lane.path, text.title + (text.body ? `\n\n${text.body}` : ''));
      if (sha) this.log.info('worktree committed', { worktreeId: lane.id, sha });
    } catch (err) {
      throw localizedError('CONFLICT', 'pr.commitFailed', { reason: reason(err) }, `Impossible de commiter le travail du worktree : ${reason(err)}`);
    }
    const baseCommit = (await resolveCommit(repository.path, lane.baseBranch)) ?? lane.baseBranch;
    if ((await commitsAhead(lane.path, baseCommit)) === 0 && !existing) {
      this.log.info('worktree has no work to publish', { worktreeId: lane.id });
      return null;
    }
    try {
      await pushBranch(lane.path, lane.branch);
    } catch (err) {
      throw localizedError('CONFLICT', 'pr.pushFailed', { branch: lane.branch, reason: reason(err) }, `Impossible de pousser ${lane.branch} : ${reason(err)}`);
    }

    let remote: RemotePullRequest;
    try {
      remote = existing
        ? await this.github.view(lane.path, existing.url)
        : ((await this.github.findByBranch(lane.path, lane.branch)) ??
          (await this.github.create(lane.path, { base, head: lane.branch, title: text.title, body: withDependencies(text.body, dependsOn), draft: text.draft })));
    } catch (err) {
      throw localizedError('PROVIDER_UNAVAILABLE', 'pr.createFailed', { reason: reason(err) }, `GitHub a refusé la pull request : ${reason(err)}`);
    }
    const known = existing ?? (await this.repo.findByUrl(remote.url));
    const now = new Date().toISOString();
    const pr: PullRequest = {
      id: known?.id ?? newId('pr'),
      workspaceId: lane.workspaceId,
      repositoryId: lane.repositoryId,
      taskId: task.id,
      worktreeId: lane.id,
      ticketId: task.ticketId,
      dependsOn: dependsOn.map((d) => d.id),
      createdAt: known?.createdAt ?? now,
      updatedAt: now,
      syncedAt: now,
      ...remote,
    };
    await this.repo.upsert(pr);
    this.bus.publish(known ? 'PullRequestUpdated' : 'PullRequestCreated', { pullRequest: pr });
    return pr;
  }

  /** Reads the PR's current status and checks from GitHub; a merged PR's worktree is then cleaned up. */
  async refresh(id: string): Promise<PullRequest> {
    const pr = await this.get(id);
    const updated = await this.sync(pr, await this.cwdFor(pr), true);
    await this.cleanupIfMerged(updated);
    return updated;
  }

  /** The lane's worktree while it exists, else the repository itself (`gh` only needs the remote). */
  private async cwdFor(pr: PullRequest): Promise<string> {
    const lane = pr.worktreeId ? await this.worktrees.get(pr.worktreeId).catch(() => null) : null;
    const cwd =
      lane && existsSync(lane.path)
        ? lane.path
        : (await this.workspaces.get(pr.workspaceId).catch(() => null))?.repositories.find((r) => r.id === pr.repositoryId)?.path;
    if (!cwd || !existsSync(cwd)) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${pr.repositoryId}`);
    return cwd;
  }

  /** `announce`: publish even when nothing but `syncedAt` changed (an explicit refresh); background passes stay quiet. */
  private async sync(pr: PullRequest, cwd: string, announce: boolean): Promise<PullRequest> {
    let remote: RemotePullRequest;
    try {
      remote = await this.github.view(cwd, pr.url);
    } catch (err) {
      throw localizedError('PROVIDER_UNAVAILABLE', 'pr.syncFailed', { reason: reason(err) }, `Impossible de lire la pull request sur GitHub : ${reason(err)}`);
    }
    const now = new Date().toISOString();
    const candidate: PullRequest = { ...pr, ...remote, syncedAt: now };
    const changed = snapshot(candidate) !== snapshot(pr);
    const updated: PullRequest = { ...candidate, updatedAt: changed ? now : pr.updatedAt };
    await this.repo.upsert(updated);
    if (changed || announce) this.bus.publish('PullRequestUpdated', { pullRequest: updated });
    if (changed && pr.status !== updated.status) this.log.info('pull request status changed', { id: pr.id, from: pr.status, to: updated.status });
    return updated;
  }

  /**
   * Once merged, the lane's work lives on the base branch: its worktree is removed — only if clean and no agent
   * works in it (never forced). The branch is kept. A kept worktree is retried on the next pass.
   */
  private async cleanupIfMerged(pr: PullRequest): Promise<boolean> {
    if (pr.status !== 'merged' || !pr.worktreeId || !this.cleanupMergedLane) return false;
    const lane = await this.worktrees.get(pr.worktreeId).catch(() => null);
    if (!lane) return false;
    let kept: string | null;
    try {
      kept = await this.cleanupMergedLane(lane.id);
    } catch (err) {
      kept = reason(err);
    }
    if (kept === null) {
      this.keptAfterMerge.delete(lane.id);
      this.log.info('merged lane worktree removed', { pullRequestId: pr.id, worktreeId: lane.id, branch: lane.branch });
      return true;
    }
    if (!this.keptAfterMerge.has(lane.id)) this.log.info('merged lane worktree kept', { pullRequestId: pr.id, worktreeId: lane.id, reason: kept });
    this.keptAfterMerge.add(lane.id);
    return false;
  }

  /**
   * One background pass: every PR GitHub can still change is re-read, then merged lanes are cleaned up.
   * Does nothing (and touches no PR) while `gh` is missing or logged out; one PR failing never stops the others.
   */
  async refreshActive(): Promise<{ refreshed: number; failed: number; cleaned: number }> {
    const result = { refreshed: 0, failed: 0, cleaned: 0 };
    const all = await this.repo.list({});
    const st = all.some((pr) => ACTIVE.has(pr.status)) ? await this.github.status().catch(() => null) : null;
    for (const pr of all) {
      if (this.stopped) break;
      let current = pr;
      if (ACTIVE.has(pr.status)) {
        if (!st?.installed || !st.authenticated) continue;
        try {
          current = await this.sync(pr, await this.cwdFor(pr), false);
          result.refreshed++;
        } catch (err) {
          result.failed++;
          this.log.warn('pull request refresh failed', { id: pr.id, reason: reason(err) });
          continue;
        }
      }
      if (await this.cleanupIfMerged(current)) result.cleaned++;
    }
    return result;
  }

  /** Starts the periodic refresh (first pass right away). `intervalMs <= 0` disables it. */
  startWatching(intervalMs: number): void {
    if (intervalMs <= 0 || this.timer || this.stopped) return;
    const tick = () => {
      this.pass ??= this.refreshActive()
        .catch((err) => this.log.warn('pull request refresh pass failed', { reason: reason(err) }))
        .finally(() => {
          this.pass = null;
        });
    };
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
    tick();
  }

  /** Stops the periodic refresh and waits for a pass in flight (before the database closes). */
  async stopWatching(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.pass;
  }
}
