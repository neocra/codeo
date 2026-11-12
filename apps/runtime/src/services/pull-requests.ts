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
    /* One lane at a time: a failure stops before touching the next repository, and a retry resumes where it stopped. */
    for (const lane of lanes) {
      const pr = await this.worktreeLocks.run(laneKey(lane.path), () => this.publishLane(task, lane, { title, body, draft: input.draft }));
      if (pr) pullRequests.push(pr);
      else skipped.push(lane.id);
    }
    return { pullRequests, skipped };
  }

  private async publishLane(
    task: Task,
    lane: Worktree,
    text: { title: string; body: string; draft: boolean },
  ): Promise<PullRequest | null> {
    const existing = await this.repo.findByWorktree(lane.id);
    if (!existsSync(lane.path)) {
      if (existing) return this.sync(existing, lane.path);
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
          (await this.github.create(lane.path, { base, head: lane.branch, title: text.title, body: text.body, draft: text.draft })));
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
      dependsOn: known?.dependsOn ?? [],
      createdAt: known?.createdAt ?? now,
      updatedAt: now,
      syncedAt: now,
      ...remote,
    };
    await this.repo.upsert(pr);
    this.bus.publish(known ? 'PullRequestUpdated' : 'PullRequestCreated', { pullRequest: pr });
    return pr;
  }

  /** Reads the PR's current status and checks from GitHub. */
  async refresh(id: string): Promise<PullRequest> {
    const pr = await this.get(id);
    const lane = pr.worktreeId ? await this.worktrees.get(pr.worktreeId).catch(() => null) : null;
    const cwd =
      lane && existsSync(lane.path)
        ? lane.path
        : (await this.workspaces.get(pr.workspaceId)).repositories.find((r) => r.id === pr.repositoryId)?.path;
    if (!cwd || !existsSync(cwd)) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${pr.repositoryId}`);
    return this.sync(pr, cwd);
  }

  private async sync(pr: PullRequest, cwd: string): Promise<PullRequest> {
    let remote: RemotePullRequest;
    try {
      remote = await this.github.view(cwd, pr.url);
    } catch (err) {
      throw localizedError('PROVIDER_UNAVAILABLE', 'pr.syncFailed', { reason: reason(err) }, `Impossible de lire la pull request sur GitHub : ${reason(err)}`);
    }
    const now = new Date().toISOString();
    const updated: PullRequest = { ...pr, ...remote, updatedAt: now, syncedAt: now };
    await this.repo.upsert(updated);
    this.bus.publish('PullRequestUpdated', { pullRequest: updated });
    return updated;
  }
}
