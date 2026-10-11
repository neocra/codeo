import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { RuntimeError } from '@codeo/contracts';
import type { WorktreeRepo } from '@codeo/database';
import { sharesWorktree, type Repository, type Subtask, type Task, type Worktree } from '@codeo/domain';
import { createWorktree, isDirty, removeWorktree, resolveCommit } from '@codeo/git';
import { newId, type Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';
import type { WorkspaceService } from './workspaces';

/** `PROJ-12 Fix the login` → `proj-12-fix-the-login` (ASCII, git-safe). */
export function branchSlug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'task'
  );
}

/** `codeo/<slug>-<task short id>`, plus `-<step>` when every subtask has its own worktree. */
export function worktreeBranch(task: Pick<Task, 'id' | 'title' | 'ticketKey'>, sub: Pick<Subtask, 'order'> | null): string {
  const short = task.id.replace(/^[a-z]+_/, '').slice(0, 8);
  const base = `codeo/${branchSlug(task.ticketKey ? `${task.ticketKey} ${task.title}` : task.title)}-${short}`;
  return sub ? `${base}-${sub.order + 1}` : base;
}

/**
 * Isolated working copies for agents. Worktrees live under the runtime data directory —
 * never inside the user's repository — on a dedicated `codeo/…` branch created from the
 * repository's default branch. Removal never discards uncommitted work silently and
 * always keeps the branch.
 */
export class WorktreeService {
  constructor(
    private readonly repo: WorktreeRepo,
    private readonly workspaces: WorkspaceService,
    private readonly bus: EventBus,
    private readonly log: Logger,
    private readonly rootDir: string,
  ) {}

  async list(filter: { workspaceId?: string | undefined; taskId?: string | undefined }): Promise<Worktree[]> {
    const rows = await this.repo.list(filter);
    return Promise.all(rows.map(async (w) => ({ ...w, dirty: existsSync(w.path) ? await isDirty(w.path).catch(() => false) : false })));
  }

  async get(id: string): Promise<Worktree> {
    const w = await this.repo.get(id);
    if (!w) throw new RuntimeError('NOT_FOUND', `Worktree introuvable: ${id}`);
    return w;
  }

  private async baseRef(repository: Repository): Promise<string> {
    for (const ref of [repository.defaultBranch, `origin/${repository.defaultBranch}`, 'HEAD']) {
      if (await resolveCommit(repository.path, ref)) return ref;
    }
    throw new RuntimeError('CONFLICT', `Le dépôt ${repository.name} n’a encore aucun commit : impossible de créer un worktree isolé.`);
  }

  /** The worktree a subtask works in: shared by the task's steps, or its own in parallel modes. Reused when it still exists. */
  async ensureForSubtask(task: Task, sub: Subtask, repositoryId: string): Promise<Worktree> {
    const ws = await this.workspaces.get(task.workspaceId);
    const repository = ws.repositories.find((r) => r.id === repositoryId);
    if (!repository) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${repositoryId}`);
    const lane = sharesWorktree(task.orchestration) ? null : sub;
    const existing = await this.repo.findLane(task.id, repository.id, lane?.id ?? null);
    if (existing && existsSync(existing.path)) return existing;
    if (existing) {
      /* Directory deleted outside Codeo: forget it, the branch is reattached below. */
      this.log.warn('worktree directory missing, recreating', { id: existing.id, path: existing.path });
      await this.repo.delete(existing.id);
    }
    const baseBranch = await this.baseRef(repository);
    const branch = worktreeBranch(task, lane);
    const target = path.join(this.rootDir, repository.id, lane ? `${task.id}-${lane.order + 1}` : task.id);
    mkdirSync(path.dirname(target), { recursive: true });
    try {
      await createWorktree({ root: repository.path, path: target, branch, baseBranch });
    } catch (err) {
      throw new RuntimeError('CONFLICT', `Impossible de créer le worktree ${branch} : ${err instanceof Error ? err.message : String(err)}`);
    }
    const worktree: Worktree = {
      id: newId('wt'),
      workspaceId: ws.id,
      repositoryId: repository.id,
      taskId: task.id,
      subtaskId: lane?.id ?? null,
      path: target,
      branch,
      baseBranch,
      dirty: false,
      createdAt: new Date().toISOString(),
    };
    await this.repo.insert(worktree);
    this.bus.publish('WorktreeCreated', { worktree });
    return worktree;
  }

  /** Removes the directory; the branch (and every commit on it) stays in the repository. */
  async remove(id: string, opts: { force: boolean }): Promise<boolean> {
    const worktree = await this.get(id);
    if (existsSync(worktree.path)) {
      const ws = await this.workspaces.get(worktree.workspaceId);
      const repository = ws.repositories.find((r) => r.id === worktree.repositoryId);
      if (!repository) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${worktree.repositoryId}`);
      if (!opts.force && (await isDirty(worktree.path).catch(() => false))) {
        throw new RuntimeError('CONFLICT', 'Ce worktree contient des modifications non commitées. Confirmez la suppression forcée pour les abandonner.');
      }
      await removeWorktree(repository.path, worktree.path, { force: opts.force });
    }
    await this.repo.delete(id);
    this.bus.publish('WorktreeRemoved', { worktreeId: id, taskId: worktree.taskId });
    return true;
  }
}
