import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { RuntimeError } from '@codeo/contracts';
import type { WorktreeRepo } from '@codeo/database';
import { sharesWorktree, type Repository, type Subtask, type Task, type Worktree } from '@codeo/domain';
import { createWorktree, isDirty, listWorktrees, pruneWorktrees, removeWorktree, resolveCommit } from '@codeo/git';
import { newId, type KeyedLock, type Logger } from '@codeo/shared-utils';
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
    /** Shared with workspace deletion so a worktree can never be created under a vanishing workspace. */
    readonly locks: KeyedLock,
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

  /** The git worktree registered at `dir`, if any; git reports canonical paths (e.g. /private/tmp on macOS). */
  private async registeredWorktree(repositoryPath: string, dir: string): Promise<{ path: string; branch: string | null } | null> {
    const real = (p: string) => {
      try {
        return realpathSync.native(p);
      } catch {
        return path.resolve(p);
      }
    };
    const target = real(dir);
    return (await listWorktrees(repositoryPath).catch(() => [])).find((w) => real(w.path) === target) ?? null;
  }

  private async baseRef(repository: Repository): Promise<string> {
    for (const ref of [repository.defaultBranch, `origin/${repository.defaultBranch}`, 'HEAD']) {
      if (await resolveCommit(repository.path, ref)) return ref;
    }
    throw new RuntimeError('CONFLICT', `Le dépôt ${repository.name} n’a encore aucun commit : impossible de créer un worktree isolé.`);
  }

  /** The worktree a subtask works in: shared by the task's steps, or its own in parallel modes. Reused when it still exists. */
  ensureForSubtask(task: Task, sub: Subtask, repositoryId: string): Promise<Worktree> {
    return this.locks.run(task.workspaceId, () => this.ensureForSubtaskLocked(task, sub, repositoryId));
  }

  private async ensureForSubtaskLocked(task: Task, sub: Subtask, repositoryId: string): Promise<Worktree> {
    const ws = await this.workspaces.get(task.workspaceId);
    const repository = ws.repositories.find((r) => r.id === repositoryId);
    if (!repository) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${repositoryId}`);
    const lane = sharesWorktree(task.orchestration) ? null : sub;
    const existing = await this.repo.findLane(task.id, repository.id, lane?.id ?? null);
    if (existing && existsSync(existing.path)) {
      /* Reuse only a directory git still knows as this lane's worktree on its branch; anything else is foreign. */
      const registered = await this.registeredWorktree(repository.path, existing.path);
      if (registered?.branch === existing.branch) return existing;
      throw new RuntimeError('CONFLICT', `Le dossier ${existing.path} n’est plus le worktree ${existing.branch} (${registered ? `branche ${registered.branch ?? '?'}` : 'non enregistré dans git'}) : déplacez-le ou supprimez-le.`);
    }
    if (existing) {
      /* Directory deleted outside Codeo: forget it and clear git's stale registration; the branch is reattached below. */
      this.log.warn('worktree directory missing, recreating', { id: existing.id, path: existing.path });
      /* Prune first: if it fails the row survives and the next attempt retries from here. */
      await pruneWorktrees(repository.path);
      await this.repo.delete(existing.id);
    }
    const baseBranch = await this.baseRef(repository);
    const branch = worktreeBranch(task, lane);
    const target = path.join(this.rootDir, repository.id, lane ? `${task.id}-${lane.order + 1}` : task.id);
    mkdirSync(path.dirname(target), { recursive: true });
    /* Crash recovery: a directory left by a run that died between `git worktree add` and the row insert
       is adopted when git knows it on the expected branch; anything else at that path is refused, never deleted. */
    let created = false;
    if (existsSync(target)) {
      const registered = await this.registeredWorktree(repository.path, target);
      if (!registered || registered.branch !== branch) {
        throw new RuntimeError('CONFLICT', `Le dossier ${target} existe déjà et n’est pas le worktree attendu (${branch}) : déplacez-le ou supprimez-le.`);
      }
      this.log.warn('adopting worktree left by an interrupted run', { path: target, branch });
    } else {
      try {
        await createWorktree({ root: repository.path, path: target, branch, baseBranch });
        created = true;
      } catch (err) {
        throw new RuntimeError('CONFLICT', `Impossible de créer le worktree ${branch} : ${err instanceof Error ? err.message : String(err)}`);
      }
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
    try {
      await this.repo.insert(worktree);
    } catch (err) {
      /* Never leave an unrecorded worktree behind: undo what this call created (the branch stays). */
      if (created) await removeWorktree(repository.path, target, { force: true }).catch((e) => this.log.error('rollback failed', { target, err: String(e) }));
      throw err;
    }
    this.bus.publish('WorktreeCreated', { worktree });
    return worktree;
  }

  /** Removes the directory; the branch (and every commit on it) stays in the repository. */
  async remove(id: string, opts: { force: boolean; /** Runs after the safety checks, right before the directory goes (release owning sessions). */ beforeRemove?: () => Promise<void> }): Promise<boolean> {
    const worktree = await this.get(id);
    if (existsSync(worktree.path)) {
      const ws = await this.workspaces.get(worktree.workspaceId);
      const repository = ws.repositories.find((r) => r.id === worktree.repositoryId);
      if (!repository) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${worktree.repositoryId}`);
      /* Only what git knows as this lane's worktree on its branch is ever removed; a replaced directory is foreign. */
      const registered = await this.registeredWorktree(repository.path, worktree.path);
      if (!registered || registered.branch !== worktree.branch) {
        throw new RuntimeError('CONFLICT', `Le dossier ${worktree.path} n’est plus le worktree ${worktree.branch} : Codeo n’y touche pas. Retirez-le manuellement puis supprimez cette entrée.`);
      }
      if (!opts.force && (await isDirty(worktree.path).catch(() => false))) {
        throw new RuntimeError('CONFLICT', 'Ce worktree contient des modifications non commitées. Confirmez la suppression forcée pour les abandonner.');
      }
      await opts.beforeRemove?.();
      await removeWorktree(repository.path, worktree.path, { force: opts.force });
    } else {
      await opts.beforeRemove?.();
      /* Directory gone (deleted outside Codeo): clear git's stale registration so the branch can be reattached later. */
      const repository = (await this.workspaces.get(worktree.workspaceId).catch(() => null))?.repositories.find((r) => r.id === worktree.repositoryId);
      if (repository) await pruneWorktrees(repository.path);
    }
    await this.repo.delete(id);
    this.bus.publish('WorktreeRemoved', { worktreeId: id, taskId: worktree.taskId });
    return true;
  }
}
