import { RuntimeError, type CommandParsedParams } from '@codeo/contracts';
import type { TaskRepo } from '@codeo/database';
import {
  aggregateTaskStatus,
  blockedSubtasks,
  orderedSubtasks,
  runnableSubtasks,
  subtaskDependencies,
  taskProgress,
  taskTransitionPath,
  type AgentSession,
  type Subtask,
  type SubtaskStatus,
  type Task,
  type TaskStatus,
  type Worktree,
  sharesWorktree,
} from '@codeo/domain';
import { newId, type Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';
import type { SessionService } from './sessions';
import type { WorkspaceService } from './workspaces';
import type { WorktreeService } from './worktrees';

const RESUME_PROMPT = 'Reprends la tâche là où tu t’étais arrêté et termine-la.';
/** Output of a previous pipeline step handed to the next one. */
const HANDOFF_MAX_CHARS = 4000;
/** Statuses in which the scheduler may launch new subtasks. */
const SCHEDULABLE: readonly TaskStatus[] = ['queued', 'running', 'waiting_approval'];
/** Session events no longer change these tasks: pause/cancel already settled their subtasks. */
const FROZEN: readonly TaskStatus[] = ['paused', 'cancelled', 'completed', 'draft'];

const SUBTASK_STATUS_FROM_SESSION: Partial<Record<AgentSession['status'], SubtaskStatus>> = {
  running: 'running',
  waiting_approval: 'waiting_approval',
  idle: 'completed',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const patchSubtask = (task: Task, id: string, patch: Partial<Subtask>): Task => ({
  ...task,
  subtasks: task.subtasks.map((s) => (s.id === id ? { ...s, ...patch } : s)),
});

/**
 * The orchestration engine. A task is a plan of subtasks (one agent each); the engine
 * launches every subtask whose dependencies are complete, places it in its worktree,
 * folds session status changes back into the plan and derives the task status from it
 * (rules in `@codeo/domain` orchestration). Every mutation of a task is serialized, so
 * events from agents running in parallel never overwrite each other.
 */
export class TaskService {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repo: TaskRepo,
    private readonly workspaces: WorkspaceService,
    private readonly sessions: SessionService,
    private readonly worktrees: WorktreeService,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {
    sessions.addSendInterceptor((s, next) => (s.taskId ? this.locked(s.taskId, async () => {
      await this.assertSendAllowed(s);
      return next();
    }) : next()));
    sessions.addListener({
      onStatus: (s) => {
        if (!s.taskId) return;
        this.locked(s.taskId, () => this.onSessionStatus(s)).catch((err) => this.log.error('task update failed', { taskId: s.taskId, err: String(err) }));
      },
    });
  }

  async init(): Promise<void> {
    /* Locked: the sessions marked disconnected at boot are reporting on these same tasks. */
    for (const { id } of await this.repo.list()) {
      await this.locked(id, async () => {
        let t = await this.get(id);
        t = await this.reconcileAssignments(t);
        if (t.status === 'running' || t.status === 'waiting_approval' || t.status === 'queued') await this.save(t, 'paused');
      });
    }
  }

  /** A session started for a subtask but never recorded on it (crash between launch and save) is reattached, never duplicated. */
  private async reconcileAssignments(task: Task): Promise<Task> {
    if (task.subtasks.every((s) => s.sessionId)) return task;
    const sessions = await this.sessions.list({ taskId: task.id });
    let changed = false;
    for (const sub of task.subtasks) {
      if (sub.sessionId) continue;
      const orphan = sessions.find((s) => s.subtaskId === sub.id);
      if (!orphan) continue;
      this.log.warn('reattaching orphaned session to its subtask', { taskId: task.id, subtaskId: sub.id, sessionId: orphan.id });
      /* The session's persisted outcome wins: finished work is not rerun, a disconnected agent is resumable work. */
      const recovered = orphan.status === 'disconnected' || orphan.status === 'created' ? 'running' : (SUBTASK_STATUS_FROM_SESSION[orphan.status] ?? 'running');
      task = patchSubtask(task, sub.id, { status: recovered, sessionId: orphan.id, worktreeId: orphan.worktreeId ?? sub.worktreeId, error: recovered === 'failed' ? (orphan.error ?? sub.error) : sub.error });
      changed = true;
    }
    if (changed) await this.repo.upsert({ ...task, updatedAt: new Date().toISOString() });
    return task;
  }

  list(workspaceId?: string): Promise<Task[]> {
    return this.repo.list(workspaceId);
  }

  async get(id: string): Promise<Task> {
    const t = await this.repo.get(id);
    if (!t) throw new RuntimeError('NOT_FOUND', `Tâche introuvable: ${id}`);
    return t;
  }

  /** Resolves once every queued task mutation has run (shutdown). */
  async drain(): Promise<void> {
    while (this.locks.size) await Promise.all(this.locks.values());
  }

  /** Runs `fn` after every pending mutation of the same task. Never call it from inside a locked section. */
  private locked<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(taskId) ?? Promise.resolve()).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(taskId, tail);
    void tail.then(() => {
      if (this.locks.get(taskId) === tail) this.locks.delete(taskId);
    });
    return run;
  }

  /** Persists the task, moving through the legal intermediate statuses when needed. */
  private async save(task: Task, status: TaskStatus, patch: Partial<Task> = {}, error?: string): Promise<Task> {
    const path = taskTransitionPath(task.status, status);
    if (!path) this.log.warn('ignored task transition', { id: task.id, from: task.status, to: status });
    const next = path ? status : task.status;
    const updated: Task = { ...task, ...patch, status: next, updatedAt: new Date().toISOString() };
    await this.repo.upsert(updated);
    this.bus.publish('TaskUpdated', { task: updated });
    if (updated.progress !== task.progress) this.bus.publish('TaskProgressChanged', { taskId: task.id, progress: updated.progress });
    if (next !== task.status && next === 'completed') this.bus.publish('TaskCompleted', { task: updated });
    if (next !== task.status && next === 'failed') this.bus.publish('TaskFailed', { task: updated, error: error ?? '' });
    return updated;
  }

  async create(input: CommandParsedParams<'tasks.create'>): Promise<Task> {
    const ws = await this.workspaces.get(input.workspaceId);
    const known = (id: string) => ws.repositories.some((r) => r.id === id);
    for (const id of input.repositoryIds) if (!known(id)) throw new RuntimeError('INVALID_PARAMS', `Dépôt inconnu: ${id}`);
    const mode = input.orchestration;
    const title = input.title.trim();
    const objective = input.objective.trim();
    const plans = input.subtasks.length
      ? input.subtasks
      : [{ title: '', instructions: '', provider: input.provider, role: input.role, model: input.model, repositoryId: null, dependsOn: [] }];

    if (mode === 'single' && plans.length !== 1) throw new RuntimeError('INVALID_PARAMS', 'Le mode simple utilise exactement un agent.');
    if (mode === 'best-of-n' && plans.length < 2) throw new RuntimeError('INVALID_PARAMS', 'Best-of-N demande au moins deux agents.');
    if ((mode === 'parallel' || mode === 'best-of-n') && input.isolation !== 'worktree') {
      throw new RuntimeError('INVALID_PARAMS', 'Des agents en parallèle doivent travailler dans des worktrees isolés.');
    }

    const repositoryIds = input.repositoryIds.length ? [...input.repositoryIds] : ws.repositories.slice(0, 1).map((r) => r.id);
    const taskId = newId('task');
    const subIds = plans.map(() => newId('sub'));
    const subtasks: Subtask[] = plans.map((p, i) => {
      if (p.repositoryId && !known(p.repositoryId)) throw new RuntimeError('INVALID_PARAMS', `Dépôt inconnu: ${p.repositoryId}`);
      if (p.dependsOn.some((d) => d >= i)) throw new RuntimeError('INVALID_PARAMS', 'Une sous-tâche ne peut dépendre que d’une sous-tâche précédente.');
      if (mode === 'best-of-n' && p.dependsOn.length) throw new RuntimeError('INVALID_PARAMS', 'Les candidats Best-of-N sont indépendants.');
      const repositoryId = p.repositoryId ?? repositoryIds[0] ?? null;
      if (repositoryId && !repositoryIds.includes(repositoryId)) repositoryIds.push(repositoryId);
      /* Best-of-N candidates all attempt the same objective. */
      const instructions = (mode === 'best-of-n' ? '' : p.instructions.trim()) || objective || title;
      return {
        id: subIds[i]!,
        taskId,
        title: p.title.trim() || (plans.length > 1 ? `${title} · ${i + 1}` : title),
        instructions,
        assignment: { role: p.role, provider: p.provider, model: p.model },
        repositoryId,
        dependsOn: p.dependsOn.map((d) => subIds[d]!),
        status: 'pending',
        sessionId: null,
        worktreeId: null,
        error: null,
        order: i,
      };
    });

    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
      workspaceId: ws.id,
      ticketId: null,
      ticketKey: input.ticketKey,
      title,
      objective,
      status: 'draft',
      orchestration: mode,
      isolation: input.isolation,
      repositoryIds,
      subtasks,
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

  /** Starts a draft task, or retries a failed one (failed and cancelled subtasks run again, in the same worktrees). */
  start(taskId: string): Promise<{ task: Task; sessions: AgentSession[] }> {
    return this.locked(taskId, async () => {
      let task = await this.get(taskId);
      if (!task.subtasks.length) throw new RuntimeError('INVALID_PARAMS', 'La tâche n’a aucune sous-tâche.');
      if (task.status !== 'draft' && task.status !== 'failed') {
        throw new RuntimeError('CONFLICT', task.status === 'paused' ? 'La tâche est en pause : reprenez-la.' : 'La tâche est déjà démarrée.');
      }
      /* Replaced sessions are closed first so an old provider handle cannot keep working beside the retry. */
      for (const s of task.subtasks) {
        if ((s.status === 'failed' || s.status === 'cancelled') && s.sessionId && this.sessions.isLive(s.sessionId)) {
          await this.sessions.cancel(s.sessionId).catch((err) => this.log.warn('could not close replaced session', { sessionId: s.sessionId, err: String(err) }));
        }
      }
      const subtasks = task.subtasks.map((s) => (s.status === 'failed' || s.status === 'cancelled' ? { ...s, status: 'pending' as const, sessionId: null, error: null } : s));
      task = await this.save(task, 'queued', { subtasks, startedAt: task.startedAt ?? new Date().toISOString() });
      const { task: advanced, sessions, errors } = await this.advance(task);
      if (!sessions.length && errors.length) throw new RuntimeError('PROVIDER_UNAVAILABLE', errors[0]!);
      return { task: advanced, sessions };
    });
  }

  cancel(taskId: string): Promise<Task> {
    return this.locked(taskId, async () => {
      const task = await this.get(taskId);
      /* Status first: the cancelled sessions' events then find a frozen task and change nothing. */
      const updated = await this.save(task, 'cancelled', {
        subtasks: task.subtasks.map((s) => (['pending', 'running', 'waiting_approval'].includes(s.status) ? { ...s, status: 'cancelled' } : s)),
      });
      await this.stopSessions(task);
      return updated;
    });
  }

  /** Stops the agents; running subtasks keep their status so `resume` continues them in the same sessions. */
  pause(taskId: string): Promise<Task> {
    return this.locked(taskId, async () => {
      const task = await this.get(taskId);
      if (!['queued', 'running', 'waiting_approval'].includes(task.status)) throw new RuntimeError('CONFLICT', 'Seule une tâche en cours peut être mise en pause.');
      const updated = await this.save(task, 'paused');
      await this.stopSessions(task);
      return updated;
    });
  }

  resume(taskId: string): Promise<Task> {
    return this.locked(taskId, async () => {
      let task = await this.get(taskId);
      if (task.status !== 'paused') throw new RuntimeError('CONFLICT', 'Seule une tâche en pause peut être reprise.');
      task = await this.save(task, 'running');
      for (const sub of task.subtasks) {
        if (sub.status !== 'running' && sub.status !== 'waiting_approval') continue;
        try {
          if (!sub.sessionId) throw new Error('no session');
          await this.sessions.send(sub.sessionId, RESUME_PROMPT, { fromScheduler: true });
          task = patchSubtask(task, sub.id, { status: 'running' });
        } catch (err) {
          /* The provider conversation cannot be resumed: start the subtask over, in the same worktree. */
          this.log.warn('subtask restarted instead of resumed', { taskId, subtaskId: sub.id, err: String(err) });
          task = patchSubtask(task, sub.id, { status: 'pending', sessionId: null });
        }
      }
      return (await this.advance(task)).task;
    });
  }

  private async stopSessions(task: Task): Promise<void> {
    for (const s of task.subtasks) {
      if (s.sessionId && this.sessions.isLive(s.sessionId)) await this.sessions.cancel(s.sessionId).catch((err) => this.log.warn('session cancel failed', { sessionId: s.sessionId, err: String(err) }));
    }
  }

  /**
   * Cancels blocked subtasks, launches every runnable one, then derives and saves the task
   * status. Runs until the plan stops changing (a failed launch can block further steps).
   */
  private async advance(task: Task, cause?: string): Promise<{ task: Task; sessions: AgentSession[]; errors: string[] }> {
    const sessions: AgentSession[] = [];
    const errors: string[] = cause ? [cause] : [];
    for (;;) {
      for (const b of blockedSubtasks(task)) task = patchSubtask(task, b.id, { status: 'cancelled' });
      const runnable = SCHEDULABLE.includes(task.status) ? runnableSubtasks(task) : [];
      if (!runnable.length) break;
      for (const sub of runnable) {
        try {
          const { session, worktree } = await this.launch(task, sub);
          task = patchSubtask(task, sub.id, { status: 'running', sessionId: session.id, worktreeId: worktree?.id ?? sub.worktreeId });
          /* Durable before the next launch: a crash here must not let recovery start a second agent for this step. */
          await this.repo.upsert({ ...task, updatedAt: new Date().toISOString() });
          sessions.push(session);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.warn('subtask launch failed', { taskId: task.id, subtaskId: sub.id, err: message });
          errors.push(message);
          task = patchSubtask(task, sub.id, { status: 'failed', error: message });
        }
      }
    }
    const status = FROZEN.includes(task.status) ? task.status : aggregateTaskStatus(task);
    /* A failure observed earlier (parallel mode) must still be reported when the task finally fails. */
    const failureCause = errors[0] ?? task.subtasks.find((s) => s.status === 'failed' && s.error)?.error ?? undefined;
    const saved = await this.save(task, status, { progress: status === 'review' ? 90 : taskProgress(task) }, failureCause);
    return { task: saved, sessions, errors };
  }

  private async launch(task: Task, sub: Subtask): Promise<{ session: AgentSession; worktree: Worktree | null }> {
    const ws = await this.workspaces.get(task.workspaceId);
    const repositoryId = sub.repositoryId ?? task.repositoryIds[0] ?? ws.repositories[0]?.id ?? null;
    const worktree = task.isolation === 'worktree' && repositoryId ? await this.worktrees.ensureForSubtask(task, sub, repositoryId) : null;
    const prefix = task.ticketKey ? `${task.ticketKey} · ${task.title}` : task.title;
    const session = await this.sessions.start(
      {
        workspaceId: task.workspaceId,
        repositoryId,
        taskId: task.id,
        provider: sub.assignment.provider,
        role: sub.assignment.role,
        title: (task.subtasks.length > 1 ? `${prefix} · ${sub.title}` : prefix).slice(0, 200),
        prompt: await this.buildPrompt(task, sub, worktree),
        model: sub.assignment.model,
      },
      worktree ? { cwd: worktree.path, worktreeId: worktree.id, subtaskId: sub.id } : undefined,
    );
    return { session, worktree };
  }

  private async buildPrompt(task: Task, sub: Subtask, worktree: Worktree | null): Promise<string> {
    const lines: (string | null)[] = [task.ticketKey ? `Ticket : ${task.ticketKey}` : null, `Tâche : ${task.title}`, ''];
    const multi = task.subtasks.length > 1;
    if (multi && task.objective && task.objective !== sub.instructions) lines.push('Objectif global :', task.objective, '');
    if (task.orchestration === 'pipeline' || task.orchestration === 'sequential') {
      const ordered = orderedSubtasks(task);
      lines.push(`Étape ${ordered.findIndex((s) => s.id === sub.id) + 1}/${ordered.length} — ${sub.title}`);
    } else if (multi) {
      lines.push(`Ta partie : ${sub.title}`);
    }
    lines.push(sub.instructions);
    if (worktree) {
      lines.push('', `Tu travailles dans un worktree Git isolé (${worktree.path}) sur la branche \`${worktree.branch}\`. Reste dans ce dossier et ne change pas de branche.`);
    }
    if (task.orchestration === 'best-of-n') {
      lines.push('', 'D’autres agents tentent le même objectif en parallèle dans leurs propres worktrees ; un humain choisira la meilleure proposition.');
    }
    if (task.orchestration === 'sequential' && subtaskDependencies(task, sub).length) {
      lines.push('', 'Les étapes précédentes ont été réalisées dans ce même dossier : pars de leur travail.');
    }
    if (task.orchestration === 'pipeline') {
      /* Each step receives the output of every earlier step, not only its direct dependency. */
      const ordered = orderedSubtasks(task);
      const earlier = ordered.slice(0, ordered.findIndex((s) => s.id === sub.id));
      const handoffs: string[] = [];
      for (const dep of earlier) {
        if (!dep.sessionId) continue;
        const output = await this.lastAssistantText(dep.sessionId);
        handoffs.push(`### ${dep.title} (${dep.assignment.role})`, output || '(aucune sortie)', '');
      }
      if (handoffs.length) lines.push('', 'Résultat des étapes précédentes (même dossier de travail) :', '', ...handoffs);
    }
    return lines.filter((l) => l !== null).join('\n').trim();
  }

  /** Everything the agent said in its last turn (a turn can hold several text blocks), capped for the prompt. */
  private async lastAssistantText(sessionId: string): Promise<string> {
    const entries = await this.sessions.entries(sessionId, 0);
    const lastUser = entries.map((e) => e.kind).lastIndexOf('user_message');
    const parts = entries
      .slice(lastUser + 1)
      .filter((e): e is Extract<typeof e, { kind: 'assistant_text' }> => e.kind === 'assistant_text' && e.text.trim().length > 0)
      .map((e) => e.text.trim());
    const text = parts.join('\n\n');
    return text.length > HANDOFF_MAX_CHARS ? `${text.slice(0, HANDOFF_MAX_CHARS)}…` : text;
  }

  /**
   * Runs under the task lock (see the interceptor). A user may talk to a task's agent while the task is
   * running or in review. Paused and failed tasks recover through tasks.resume / tasks.start so every
   * step is rescheduled; closed tasks never come back to life; and no agent is prompted while another
   * step works in the same worktree.
   */
  private async assertSendAllowed(session: AgentSession): Promise<void> {
    if (!session.taskId) return;
    const task = await this.repo.get(session.taskId);
    if (!task) return;
    const sub = task.subtasks.find((s) => s.sessionId === session.id);
    /* A session the scheduler replaced (retry) must never run again beside its replacement. */
    if (!sub) throw new RuntimeError('CONFLICT', 'Cette session a été remplacée par une nouvelle tentative : ouvrez la session actuelle de l’étape.');
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new RuntimeError('CONFLICT', 'Cette tâche est terminée : créez une nouvelle tâche pour continuer.');
    }
    if (task.status === 'paused') throw new RuntimeError('CONFLICT', 'La tâche est en pause : reprenez-la pour continuer.');
    if (task.status === 'failed') throw new RuntimeError('CONFLICT', 'La tâche est en échec : redémarrez-la pour relancer ses étapes.');
    if (task.status === 'draft') throw new RuntimeError('CONFLICT', 'La tâche n’est pas démarrée.');
    const occupied = task.subtasks.find(
      (o) => o.id !== sub.id && (o.status === 'running' || o.status === 'waiting_approval') && (sharesWorktree(task.orchestration) || (o.worktreeId !== null && o.worktreeId === sub.worktreeId)),
    );
    if (occupied) {
      throw new RuntimeError('CONFLICT', `L’étape « ${occupied.title} » travaille déjà dans ce worktree : attendez qu’elle termine.`);
    }
  }

  private async onSessionStatus(session: AgentSession): Promise<void> {
    let task = await this.repo.get(session.taskId!);
    if (!task || FROZEN.includes(task.status)) return;
    const sub = task.subtasks.find((s) => s.sessionId === session.id);
    if (!sub) return;
    if (session.status === 'disconnected') {
      /* Only an agent that was working interrupts the task; an idle one (task in review) does not. */
      if (sub.status === 'running' || sub.status === 'waiting_approval') await this.save(task, 'paused');
      return;
    }
    const status = SUBTASK_STATUS_FROM_SESSION[session.status];
    if (!status) return;
    task = patchSubtask(task, sub.id, status === 'failed' ? { status, error: session.error ?? sub.error } : { status });
    await this.advance(task, status === 'failed' ? (session.error ?? undefined) : undefined);
  }
}
