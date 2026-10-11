import { RuntimeError, type CommandParsedParams } from '@codeo/contracts';
import type { TaskRepo } from '@codeo/database';
import { taskTransition, type AgentSession, type SessionStatus, type Task, type TaskStatus } from '@codeo/domain';
import { newId, type Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';
import type { SessionService } from './sessions';
import type { WorkspaceService } from './workspaces';

/**
 * Phase 3 scope: one task = one subtask = one session. The orchestration engine (phase 4)
 * will schedule several subtasks over this same service.
 */
export class TaskService {
  constructor(
    private readonly repo: TaskRepo,
    private readonly workspaces: WorkspaceService,
    private readonly sessions: SessionService,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {
    sessions.addListener({ onStatus: (s, prev) => void this.onSessionStatus(s, prev) });
  }

  async init(): Promise<void> {
    for (const t of await this.repo.list()) {
      if (t.status === 'running' || t.status === 'waiting_approval') await this.transition(t, 'paused');
    }
  }

  list(workspaceId?: string): Promise<Task[]> {
    return this.repo.list(workspaceId);
  }

  async get(id: string): Promise<Task> {
    const t = await this.repo.get(id);
    if (!t) throw new RuntimeError('NOT_FOUND', `Tâche introuvable: ${id}`);
    return t;
  }

  private async transition(task: Task, status: TaskStatus, patch: Partial<Task> = {}): Promise<Task> {
    let next: TaskStatus;
    try {
      next = taskTransition(task.status, status);
    } catch {
      this.log.warn('ignored task transition', { id: task.id, from: task.status, to: status });
      return task;
    }
    const now = new Date().toISOString();
    const updated: Task = { ...task, ...patch, status: next, updatedAt: now };
    await this.repo.upsert(updated);
    if (next !== task.status) {
      this.bus.publish('TaskUpdated', { task: updated });
      if (next === 'completed') this.bus.publish('TaskCompleted', { task: updated });
      if (next === 'failed') this.bus.publish('TaskFailed', { task: updated, error: patch.objective ?? '' });
    }
    return updated;
  }

  async create(input: CommandParsedParams<'tasks.create'>): Promise<Task> {
    const ws = await this.workspaces.get(input.workspaceId);
    const repositoryIds = input.repositoryIds.length ? input.repositoryIds : ws.repositories.slice(0, 1).map((r) => r.id);
    for (const id of repositoryIds) if (!ws.repositories.some((r) => r.id === id)) throw new RuntimeError('INVALID_PARAMS', `Dépôt inconnu: ${id}`);
    const now = new Date().toISOString();
    const taskId = newId('task');
    const task: Task = {
      id: taskId,
      workspaceId: ws.id,
      ticketId: null,
      ticketKey: input.ticketKey,
      title: input.title.trim(),
      objective: input.objective.trim(),
      status: 'draft',
      orchestration: 'single',
      repositoryIds,
      subtasks: [
        {
          id: newId('sub'),
          taskId,
          title: input.title.trim(),
          instructions: input.objective.trim() || input.title.trim(),
          assignment: { role: input.role, provider: input.provider, model: input.model },
          repositoryId: repositoryIds[0] ?? null,
          dependsOn: [],
          status: 'pending',
          sessionId: null,
          order: 0,
        },
      ],
      progress: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    await this.repo.upsert(task);
    this.bus.publish('TaskCreated', { task });
    return task;
  }

  async start(taskId: string): Promise<{ task: Task; session: AgentSession }> {
    let task = await this.get(taskId);
    const subtask = task.subtasks[0];
    if (!subtask) throw new RuntimeError('INVALID_PARAMS', 'La tâche n’a aucune sous-tâche.');
    if (task.status === 'running' || task.status === 'waiting_approval') throw new RuntimeError('CONFLICT', 'La tâche est déjà en cours.');
    task = await this.transition(task, 'queued');
    const prompt = [task.ticketKey ? `Ticket: ${task.ticketKey}` : null, `Tâche: ${task.title}`, '', subtask.instructions].filter((l) => l !== null).join('\n');
    const session = await this.sessions.start({
      workspaceId: task.workspaceId,
      repositoryId: subtask.repositoryId,
      taskId: task.id,
      provider: subtask.assignment.provider,
      role: subtask.assignment.role,
      title: task.ticketKey ? `${task.ticketKey} · ${task.title}` : task.title,
      prompt,
      model: subtask.assignment.model,
    });
    task = await this.transition(task, 'running', {
      startedAt: new Date().toISOString(),
      progress: 10,
      subtasks: task.subtasks.map((s, i) => (i === 0 ? { ...s, status: 'running', sessionId: session.id } : s)),
    });
    this.bus.publish('TaskProgressChanged', { taskId: task.id, progress: task.progress });
    return { task, session };
  }

  async cancel(taskId: string): Promise<Task> {
    const task = await this.get(taskId);
    for (const s of task.subtasks) if (s.sessionId && this.sessions.isLive(s.sessionId)) await this.sessions.cancel(s.sessionId);
    return this.transition(task, 'cancelled', { subtasks: task.subtasks.map((s) => (s.status === 'running' || s.status === 'waiting_approval' ? { ...s, status: 'cancelled' } : s)) });
  }

  async pause(taskId: string): Promise<Task> {
    const task = await this.get(taskId);
    for (const s of task.subtasks) if (s.sessionId && this.sessions.isLive(s.sessionId)) await this.sessions.cancel(s.sessionId);
    return this.transition(task, 'paused');
  }

  async resume(taskId: string): Promise<Task> {
    const task = await this.get(taskId);
    const sub = task.subtasks[0];
    if (!sub?.sessionId) throw new RuntimeError('CONFLICT', 'Aucune session à reprendre.');
    await this.sessions.send(sub.sessionId, 'Reprends la tâche là où tu t’étais arrêté et termine-la.');
    return this.transition(task, 'running');
  }

  private async onSessionStatus(session: AgentSession, previous: SessionStatus): Promise<void> {
    if (!session.taskId) return;
    const task = await this.repo.get(session.taskId);
    if (!task) return;
    const sub = task.subtasks.find((s) => s.sessionId === session.id);
    if (!sub) return;
    const patchSub = (status: typeof sub.status) => task.subtasks.map((s) => (s.id === sub.id ? { ...s, status } : s));
    switch (session.status) {
      case 'waiting_approval':
        await this.transition(task, 'waiting_approval', { subtasks: patchSub('waiting_approval') });
        return;
      case 'running':
        if (previous === 'waiting_approval' || task.status === 'review') await this.transition(task, 'running', { subtasks: patchSub('running') });
        return;
      case 'idle':
        /* Agent finished its turn: the work is ready for the human to review. */
        await this.transition(task, 'review', { progress: 90, subtasks: patchSub('completed') });
        this.bus.publish('TaskProgressChanged', { taskId: task.id, progress: 90 });
        return;
      case 'failed':
        await this.transition(task, 'failed', { subtasks: patchSub('failed'), objective: task.objective });
        return;
      case 'cancelled':
        if (task.status !== 'cancelled' && task.status !== 'paused') await this.transition(task, 'cancelled', { subtasks: patchSub('cancelled') });
        return;
      case 'disconnected':
        await this.transition(task, 'paused');
        return;
      default:
        return;
    }
  }
}
