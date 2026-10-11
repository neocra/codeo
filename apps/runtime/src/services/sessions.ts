import { roleInstructions, type ProviderEvent, type ProviderSessionHandle } from '@codeo/agent-provider-core';
import { RuntimeError, type CommandParsedParams } from '@codeo/contracts';
import type { SessionRepo } from '@codeo/database';
import { sessionTransition, type AgentSession, type SessionEntry, type SessionStatus, type Workspace } from '@codeo/domain';
import { existsSync } from 'node:fs';
import { KeyedLock, newId, type Logger } from '@codeo/shared-utils';
import type { EventBus } from '../event-bus';
import type { ApprovalService } from './approvals';
import type { ProviderRegistry } from './providers';
import type { WorkspaceService } from './workspaces';

type EntryDraft = SessionEntry extends infer E ? (E extends SessionEntry ? Omit<E, 'id' | 'sessionId' | 'seq' | 'at'> : never) : never;

interface Live {
  handle: ProviderSessionHandle;
  seq: number;
  /** blockId → streaming assistant entry */
  streaming: Map<string, Extract<SessionEntry, { kind: 'assistant_text' }>>;
  tools: Map<string, Extract<SessionEntry, { kind: 'tool_call' }>>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Provider events are handled strictly in order per session. */
  chain: Promise<void>;
}

/** Where a session runs when the task scheduler places it (worktree). Plain sessions run in the repository root. */
export interface SessionPlacement {
  cwd: string;
  worktreeId: string | null;
  subtaskId: string | null;
}

export type SendInterceptor = (session: AgentSession, next: () => Promise<AgentSession>) => Promise<AgentSession>;

export interface SessionListener {
  onStatus(session: AgentSession, previous: SessionStatus): void;
}

/**
 * Owns every live agent session: starts provider processes, turns provider events into
 * persisted transcript entries + runtime events, and routes permission requests through
 * the approval service. The UI never talks to a provider directly.
 */
export class SessionService {
  private live = new Map<string, Live>();
  private listeners: SessionListener[] = [];
  private sendInterceptors: SendInterceptor[] = [];

  constructor(
    private readonly repo: SessionRepo,
    private readonly workspaces: WorkspaceService,
    private readonly providers: ProviderRegistry,
    private readonly approvals: ApprovalService,
    private readonly bus: EventBus,
    private readonly log: Logger,
    /** Serialises everything that starts or stops work inside a worktree (shared with worktree removal). */
    readonly worktreeLocks: KeyedLock = new KeyedLock(),
  ) {}

  /**
   * Wraps every user turn: the task scheduler runs its checks and the send itself under the task's
   * mutation lock, so a send can never interleave with a step being launched or the task being closed.
   */
  addSendInterceptor(interceptor: SendInterceptor): void {
    this.sendInterceptors.push(interceptor);
  }

  addListener(l: SessionListener): void {
    this.listeners.push(l);
  }

  async init(): Promise<void> {
    /* Sessions that were running when the runtime died are marked disconnected (resumable). */
    for (const s of await this.repo.list({ statuses: ['running', 'waiting_approval', 'created'] })) {
      await this.setStatus(s, 'disconnected', 'Runtime redémarré pendant la session.');
    }
  }

  list(filter: { workspaceId?: string | undefined; taskId?: string | undefined }): Promise<AgentSession[]> {
    return this.repo.list(filter);
  }

  async get(id: string): Promise<AgentSession> {
    const s = await this.repo.get(id);
    if (!s) throw new RuntimeError('NOT_FOUND', `Session introuvable: ${id}`);
    return s;
  }

  entries(id: string, afterSeq: number): Promise<SessionEntry[]> {
    return this.repo.entries(id, afterSeq);
  }

  /** Runs a mutation after every queued provider event of the session, so no handler overwrites it with a stale row. */
  private serialize<T>(live: Live, fn: () => Promise<T>): Promise<T> {
    const run = live.chain.then(fn);
    live.chain = run.then(
      () => undefined,
      (err) => this.log.error('session mutation failed', { err: String(err) }),
    );
    return run;
  }

  private async setStatus(session: AgentSession, status: SessionStatus, error: string | null = null): Promise<AgentSession> {
    const previous = session.status;
    let next: SessionStatus;
    try {
      next = sessionTransition(previous, status);
    } catch {
      this.log.warn('ignored session transition', { id: session.id, from: previous, to: status });
      return session;
    }
    const now = new Date().toISOString();
    const updated: AgentSession = { ...session, status: next, error, updatedAt: now, lastActivityAt: now };
    await this.repo.upsert(updated);
    if (next !== previous) {
      this.bus.publish('SessionUpdated', { session: updated });
      for (const l of this.listeners) l.onStatus(updated, previous);
    }
    return updated;
  }

  private async append(session: AgentSession, live: Live, entry: EntryDraft): Promise<SessionEntry> {
    live.seq += 1;
    const full = { ...entry, id: newId('ent'), sessionId: session.id, seq: live.seq, at: new Date().toISOString() } as SessionEntry;
    await this.repo.appendEntry(full);
    this.bus.publish('SessionEntryAppended', { sessionId: session.id, entry: full });
    return full;
  }

  private async update(session: AgentSession, entry: SessionEntry): Promise<void> {
    await this.repo.updateEntry(entry);
    this.bus.publish('SessionEntryUpdated', { sessionId: session.id, entry });
  }

  private resolveCwd(ws: Workspace, repositoryId: string | null): string {
    if (repositoryId) {
      const r = ws.repositories.find((x) => x.id === repositoryId);
      if (!r) throw new RuntimeError('NOT_FOUND', `Dépôt introuvable: ${repositoryId}`);
      return r.path;
    }
    const first = ws.repositories[0];
    if (!first) throw new RuntimeError('INVALID_PARAMS', 'L’espace de travail n’a aucun dépôt.');
    return first.path;
  }

  async start(input: CommandParsedParams<'sessions.start'>, placement?: SessionPlacement): Promise<AgentSession> {
    const ws = await this.workspaces.get(input.workspaceId);
    const cwd = placement?.cwd ?? this.resolveCwd(ws, input.repositoryId);
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: newId('ses'),
      workspaceId: ws.id,
      taskId: input.taskId,
      subtaskId: placement?.subtaskId ?? null,
      repositoryId: input.repositoryId ?? ws.repositories[0]?.id ?? null,
      worktreeId: placement?.worktreeId ?? null,
      provider: input.provider,
      role: input.role,
      title: input.title?.trim() || input.prompt.split('\n')[0]!.slice(0, 80),
      status: 'created',
      providerSessionId: null,
      cwd,
      model: input.model,
      error: null,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };
    await this.repo.upsert(session);
    this.bus.publish('SessionCreated', { session });
    return placement?.worktreeId ? this.worktreeLocks.run(placement.worktreeId, () => this.launch(session, input.prompt)) : this.launch(session, input.prompt);
  }

  /** Starts (or resumes) the provider process behind a session and sends the prompt. */
  private async launch(session: AgentSession, prompt: string): Promise<AgentSession> {
    if (!existsSync(session.cwd)) {
      throw new RuntimeError('CONFLICT', `Le dossier de travail de cette session n’existe plus (${session.cwd}) : le worktree a été supprimé.`);
    }
    const provider = this.providers.get(session.provider);
    const status = this.providers.status(session.provider);
    if (!status?.installed) {
      const failed = await this.setStatus(session, 'failed', status?.error ?? 'Fournisseur non disponible.');
      throw new RuntimeError('PROVIDER_UNAVAILABLE', failed.error ?? 'Fournisseur non disponible.');
    }
    const live: Live = { handle: null as unknown as ProviderSessionHandle, seq: await this.repo.lastSeq(session.id), streaming: new Map(), tools: new Map(), flushTimer: null, chain: Promise.resolve() };
    this.live.set(session.id, live);
    let current = session;
    const sessionId = session.id;

    const onEvent = (ev: ProviderEvent) => {
      live.chain = live.chain.then(() => this.handleProviderEvent(sessionId, live, ev)).catch((err) => this.log.error('event handling failed', { sessionId, err: String(err) }));
    };

    try {
      live.handle = await provider.startSession({
        cwd: session.cwd,
        role: session.role,
        roleInstructions: roleInstructions(session.role),
        model: session.model,
        resumeProviderSessionId: session.providerSessionId,
        onEvent,
        onPermissionRequest: async (req) => {
          const s = await this.serialize(live, async () => this.setStatus(await this.get(sessionId), 'waiting_approval'));
          const decision = await this.approvals.request({ sessionId, taskId: s.taskId, workspaceId: s.workspaceId, provider: s.provider }, req);
          await this.serialize(live, async () => {
            const after = await this.get(sessionId);
            if (after.status === 'waiting_approval') await this.setStatus(after, 'running');
          });
          return decision;
        },
        logger: this.log,
      });
    } catch (err) {
      this.live.delete(sessionId);
      const failed = await this.setStatus(current, 'failed', err instanceof Error ? err.message : String(err));
      throw new RuntimeError('PROVIDER_UNAVAILABLE', failed.error ?? 'Échec du démarrage.');
    }
    current = await this.setStatus(current, 'running');
    await this.append(current, live, { kind: 'user_message', text: prompt });
    await live.handle.send(prompt);
    return current;
  }

  private async handleProviderEvent(sessionId: string, live: Live, ev: ProviderEvent): Promise<void> {
    const session = await this.get(sessionId);
    switch (ev.type) {
      case 'session_started': {
        if (session.providerSessionId !== ev.providerSessionId || (ev.model && session.model !== ev.model)) {
          const updated = { ...session, providerSessionId: ev.providerSessionId, model: ev.model ?? session.model, updatedAt: new Date().toISOString() };
          await this.repo.upsert(updated);
          this.bus.publish('SessionUpdated', { session: updated });
        }
        return;
      }
      case 'status':
        if (ev.state === 'running' && session.status === 'idle') await this.setStatus(session, 'running');
        return;
      case 'text_delta': {
        const entry = live.streaming.get(ev.blockId);
        if (!entry) {
          const created = (await this.append(session, live, { kind: 'assistant_text', text: ev.delta, streaming: true })) as Extract<SessionEntry, { kind: 'assistant_text' }>;
          live.streaming.set(ev.blockId, created);
          return;
        }
        entry.text += ev.delta;
        /* Deltas are coalesced: one update event per ~60ms instead of one per token. */
        if (!live.flushTimer) {
          live.flushTimer = setTimeout(() => {
            live.flushTimer = null;
            for (const e of live.streaming.values()) this.bus.publish('SessionEntryUpdated', { sessionId, entry: e });
          }, 60);
        }
        return;
      }
      case 'text_complete': {
        const existing = live.streaming.get(ev.blockId);
        live.streaming.delete(ev.blockId);
        if (existing) {
          const done = { ...existing, text: ev.text, streaming: false };
          await this.update(session, done);
        } else if (ev.text.trim()) {
          await this.append(session, live, { kind: 'assistant_text', text: ev.text, streaming: false });
        }
        return;
      }
      case 'thinking':
        await this.append(session, live, { kind: 'thinking', text: ev.text });
        return;
      case 'tool_call_started': {
        const entry = (await this.append(session, live, { kind: 'tool_call', toolUseId: ev.toolUseId, tool: ev.tool, input: ev.input, status: 'running', output: null })) as Extract<SessionEntry, { kind: 'tool_call' }>;
        live.tools.set(ev.toolUseId, entry);
        return;
      }
      case 'tool_call_completed': {
        const entry = live.tools.get(ev.toolUseId);
        if (!entry) return;
        live.tools.delete(ev.toolUseId);
        await this.update(session, { ...entry, status: ev.isError ? 'failed' : 'completed', output: ev.output });
        return;
      }
      case 'tool_call_denied': {
        const entry = live.tools.get(ev.toolUseId);
        if (entry) {
          live.tools.delete(ev.toolUseId);
          await this.update(session, { ...entry, status: 'denied', output: ev.reason });
        } else {
          await this.append(session, live, { kind: 'system', level: 'warn', text: `Outil refusé : ${ev.reason}` });
        }
        return;
      }
      case 'system':
        await this.append(session, live, { kind: 'system', level: ev.level, text: ev.text });
        return;
      case 'turn_completed': {
        for (const [id, e] of live.streaming) {
          await this.update(session, { ...e, streaming: false });
          live.streaming.delete(id);
        }
        await this.append(session, live, { kind: 'result', ok: ev.ok, summary: ev.summary, durationMs: ev.durationMs, costUsd: ev.costUsd, turns: ev.turns });
        const fresh = await this.get(sessionId);
        if (fresh.status === 'running' || fresh.status === 'waiting_approval') {
          /* A turn the provider reports as failed (Codex turn.failed, Claude error_* results) is a failed session, not an idle one. */
          await this.setStatus(fresh, ev.ok ? 'idle' : 'failed', ev.ok ? null : ev.summary || 'Le tour de l’agent a échoué.');
        }
        return;
      }
      case 'error': {
        await this.append(session, live, { kind: 'system', level: 'error', text: ev.message });
        if (ev.fatal) {
          this.live.delete(sessionId);
          this.approvals.cancelForSession(sessionId);
          await this.setStatus(await this.get(sessionId), 'failed', ev.message);
        }
        return;
      }
    }
  }

  /** `fromScheduler`: the task scheduler already holds the task lock, so interceptors are skipped (they would deadlock). */
  async send(sessionId: string, text: string, opts: { fromScheduler?: boolean } = {}): Promise<AgentSession> {
    const session = await this.get(sessionId);
    const inner = () => (session.worktreeId ? this.worktreeLocks.run(session.worktreeId, () => this.sendUnlocked(sessionId, text)) : this.sendUnlocked(sessionId, text));
    if (opts.fromScheduler) return inner();
    return this.sendInterceptors.reduceRight<() => Promise<AgentSession>>((next, interceptor) => () => interceptor(session, next), inner)();
  }

  private async sendUnlocked(sessionId: string, text: string): Promise<AgentSession> {
    let session = await this.get(sessionId);
    const live = this.live.get(sessionId);
    if (!live) {
      /* Reopened session: resume the provider conversation with the stored provider session id. */
      if (!session.providerSessionId) throw new RuntimeError('CONFLICT', 'Cette session ne peut pas être reprise (aucun identifiant fournisseur).');
      return this.launch(session, text);
    }
    if (session.status === 'waiting_approval') throw new RuntimeError('CONFLICT', 'Répondez d’abord à la demande d’approbation.');
    session = await this.serialize(live, async () => {
      const s = await this.setStatus(await this.get(sessionId), 'running');
      await this.append(s, live, { kind: 'user_message', text });
      return s;
    });
    await live.handle.send(text);
    return session;
  }

  /** Runs `fn` under the session's worktree lock (none when the session is not in a worktree). */
  private inWorktree<T>(session: AgentSession, fn: () => Promise<T>): Promise<T> {
    return session.worktreeId ? this.worktreeLocks.run(session.worktreeId, fn) : fn();
  }

  async cancel(sessionId: string): Promise<AgentSession> {
    const session = await this.get(sessionId);
    return this.inWorktree(session, () => this.cancelUnlocked(sessionId));
  }

  /** Cancel without taking the worktree lock — for callers that already hold it. */
  async cancelUnlocked(sessionId: string): Promise<AgentSession> {
    const session = await this.get(sessionId);
    const live = this.live.get(sessionId);
    this.approvals.cancelForSession(sessionId);
    if (live) {
      await live.handle.interrupt().catch(() => undefined);
      /* The live entry goes only once the provider is really gone, so a failed close stays visible and retryable. */
      await live.handle.close();
      this.live.delete(sessionId);
      await this.serialize(live, () => this.append(session, live, { kind: 'system', level: 'info', text: 'Session arrêtée par l’utilisateur.' }));
    }
    return this.setStatus(await this.get(sessionId), 'cancelled');
  }

  /** Closes an idle session's provider process (e.g. its worktree is being removed). Running sessions are refused. */
  async release(sessionId: string, reason: string): Promise<AgentSession> {
    const session = await this.get(sessionId);
    return this.inWorktree(session, () => this.releaseUnlocked(sessionId, reason));
  }

  /** Release without taking the worktree lock — for callers that already hold it (worktree removal). */
  async releaseUnlocked(sessionId: string, reason: string): Promise<AgentSession> {
    const session = await this.get(sessionId);
    const live = this.live.get(sessionId);
    if (!live) return session;
    if (session.status === 'running' || session.status === 'waiting_approval') {
      throw new RuntimeError('CONFLICT', 'Un agent travaille encore dans cette session : arrêtez-la d’abord.');
    }
    await live.handle.close();
    this.live.delete(sessionId);
    await this.serialize(live, () => this.append(session, live, { kind: 'system', level: 'info', text: reason }));
    return this.setStatus(await this.get(sessionId), 'completed');
  }

  isLive(sessionId: string): boolean {
    return this.live.has(sessionId);
  }

  async shutdown(): Promise<void> {
    for (const [id, live] of this.live) {
      this.live.delete(id);
      await live.handle.close().catch(() => undefined);
      const s = await this.repo.get(id);
      if (s) await this.setStatus(s, 'disconnected', 'Runtime arrêté.');
    }
  }
}
