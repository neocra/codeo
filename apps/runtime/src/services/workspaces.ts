import { localizedError, RuntimeError, type CommandParsedParams } from '@codeo/contracts';
import type { WorkspaceRepo } from '@codeo/database';
import type { ExecutionMode, Repository, Workspace } from '@codeo/domain';
import { inspectRepository } from '@codeo/git';
import { newId } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';

export class WorkspaceService {
  constructor(
    private readonly repo: WorkspaceRepo,
    private readonly bus: EventBus,
    private readonly machineId: string,
  ) {}

  list(): Promise<Workspace[]> {
    return this.repo.list();
  }

  async get(id: string): Promise<Workspace> {
    const ws = await this.repo.get(id);
    if (!ws) throw new RuntimeError('NOT_FOUND', `Espace de travail introuvable: ${id}`);
    return ws;
  }

  private async toRepository(workspaceId: string, dir: string): Promise<Repository> {
    const info = await inspectRepository(dir);
    if (!info.isGitRepository || !info.root) throw localizedError('INVALID_PARAMS', 'repo.notGit', { path: dir }, `Ce dossier n'est pas un dépôt Git: ${dir}`);
    return {
      id: newId('repo'),
      workspaceId,
      name: info.name,
      path: info.root,
      defaultBranch: info.defaultBranch ?? 'main',
      remoteUrl: info.remoteUrl,
      services: [],
      createdAt: new Date().toISOString(),
    };
  }

  async create(input: CommandParsedParams<'workspaces.create'>): Promise<Workspace> {
    const id = newId('ws');
    const now = new Date().toISOString();
    const repositories: Repository[] = [];
    for (const p of input.repositoryPaths) {
      const r = await this.toRepository(id, p);
      if (repositories.some((x) => x.path === r.path)) continue;
      repositories.push(r);
    }
    if (input.type === 'monorepo' && repositories.length !== 1) {
      throw localizedError('INVALID_PARAMS', 'workspace.monorepoOne', undefined, 'Un monorepo contient exactement un dépôt.');
    }
    const ws: Workspace = {
      id,
      machineId: this.machineId,
      name: input.name.trim(),
      description: input.description,
      type: input.type,
      repositories,
      defaultProvider: 'claude-code',
      defaultExecutionMode: input.defaultExecutionMode ?? 'auto',
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.insert(ws);
    this.bus.publish('WorkspaceCreated', { workspace: ws });
    return ws;
  }

  /** Changes workspace-level settings; only affects sessions and tasks created afterwards. */
  async update(workspaceId: string, patch: { defaultExecutionMode: ExecutionMode }): Promise<Workspace> {
    await this.get(workspaceId);
    await this.repo.update(workspaceId, { defaultExecutionMode: patch.defaultExecutionMode, updatedAt: new Date().toISOString() });
    const updated = await this.get(workspaceId);
    this.bus.publish('WorkspaceUpdated', { workspace: updated });
    return updated;
  }

  async addRepository(workspaceId: string, dir: string): Promise<Workspace> {
    const ws = await this.get(workspaceId);
    const r = await this.toRepository(ws.id, dir);
    if (ws.repositories.some((x) => x.path === r.path)) throw localizedError('CONFLICT', 'repo.duplicate', undefined, 'Ce dépôt est déjà dans l’espace de travail.');
    if (ws.type === 'monorepo') throw localizedError('INVALID_PARAMS', 'workspace.monorepoSingle', undefined, 'Un monorepo ne contient qu’un dépôt.');
    await this.repo.insertRepository(r);
    const updated = await this.get(workspaceId);
    this.bus.publish('WorkspaceUpdated', { workspace: updated });
    return updated;
  }

  async removeRepository(workspaceId: string, repositoryId: string): Promise<Workspace> {
    await this.get(workspaceId);
    await this.repo.removeRepository(workspaceId, repositoryId);
    const updated = await this.get(workspaceId);
    this.bus.publish('WorkspaceUpdated', { workspace: updated });
    return updated;
  }

  async delete(workspaceId: string): Promise<boolean> {
    const deleted = await this.repo.delete(workspaceId);
    if (deleted) this.bus.publish('WorkspaceDeleted', { workspaceId });
    return deleted;
  }
}
