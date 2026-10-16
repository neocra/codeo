import {
  AgentSessionSchema,
  ApprovalRequestSchema,
  SessionEntrySchema,
  TaskSchema,
  WorkspaceSchema,
  type AgentSession,
  type ApprovalRequest,
  type Repository,
  type SessionEntry,
  type Task,
  type Workspace,
  type Worktree,
  WorktreeSchema,
} from '@codeo/domain';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client';
import * as s from './schema';

const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: string, fallback: T): T => {
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ */
export class WorkspaceRepo {
  constructor(private db: Database) {}

  private hydrate(row: typeof s.workspaces.$inferSelect, repos: (typeof s.repositories.$inferSelect)[]): Workspace {
    return WorkspaceSchema.parse({
      ...row,
      repositories: repos
        .filter((r) => r.workspaceId === row.id)
        .map((r) => ({ ...r, services: parse(r.services, []) })),
    });
  }

  async list(): Promise<Workspace[]> {
    const rows = await this.db.select().from(s.workspaces).orderBy(asc(s.workspaces.createdAt));
    const repos = await this.db.select().from(s.repositories);
    return rows.map((r) => this.hydrate(r, repos));
  }

  async get(id: string): Promise<Workspace | null> {
    const row = (await this.db.select().from(s.workspaces).where(eq(s.workspaces.id, id)))[0];
    if (!row) return null;
    const repos = await this.db.select().from(s.repositories).where(eq(s.repositories.workspaceId, id));
    return this.hydrate(row, repos);
  }

  async insert(ws: Workspace): Promise<void> {
    await this.db.insert(s.workspaces).values({
      id: ws.id,
      machineId: ws.machineId,
      name: ws.name,
      description: ws.description,
      type: ws.type,
      defaultProvider: ws.defaultProvider,
      defaultExecutionMode: ws.defaultExecutionMode,
      createdAt: ws.createdAt,
      updatedAt: ws.updatedAt,
    });
    for (const r of ws.repositories) await this.insertRepository(r);
  }

  async update(id: string, patch: { defaultExecutionMode: Workspace['defaultExecutionMode']; updatedAt: string }): Promise<void> {
    await this.db.update(s.workspaces).set(patch).where(eq(s.workspaces.id, id));
  }

  async insertRepository(r: Repository): Promise<void> {
    await this.db.insert(s.repositories).values({
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      path: r.path,
      defaultBranch: r.defaultBranch,
      remoteUrl: r.remoteUrl,
      services: json(r.services),
      createdAt: r.createdAt,
    });
    await this.db.update(s.workspaces).set({ updatedAt: new Date().toISOString() }).where(eq(s.workspaces.id, r.workspaceId));
  }

  async removeRepository(workspaceId: string, repositoryId: string): Promise<void> {
    await this.db.delete(s.repositories).where(and(eq(s.repositories.id, repositoryId), eq(s.repositories.workspaceId, workspaceId)));
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.delete(s.workspaces).where(eq(s.workspaces.id, id));
    await this.db.delete(s.repositories).where(eq(s.repositories.workspaceId, id));
    return res.rowsAffected > 0;
  }
}

/* ------------------------------------------------------------------ */
export class TaskRepo {
  constructor(private db: Database) {}
  private hydrate(row: typeof s.tasks.$inferSelect): Task {
    return TaskSchema.parse({ ...row, repositoryIds: parse(row.repositoryIds, []), subtasks: parse(row.subtasks, []) });
  }
  async list(workspaceId?: string): Promise<Task[]> {
    const q = this.db.select().from(s.tasks).orderBy(desc(s.tasks.updatedAt));
    const rows = workspaceId ? await q.where(eq(s.tasks.workspaceId, workspaceId)) : await q;
    return rows.map((r) => this.hydrate(r));
  }
  async get(id: string): Promise<Task | null> {
    const row = (await this.db.select().from(s.tasks).where(eq(s.tasks.id, id)))[0];
    return row ? this.hydrate(row) : null;
  }
  async upsert(t: Task): Promise<void> {
    const values = {
      id: t.id,
      workspaceId: t.workspaceId,
      ticketId: t.ticketId,
      ticketKey: t.ticketKey,
      title: t.title,
      objective: t.objective,
      status: t.status,
      orchestration: t.orchestration,
      isolation: t.isolation,
      executionMode: t.executionMode,
      repositoryIds: json(t.repositoryIds),
      subtasks: json(t.subtasks),
      progress: Math.round(t.progress),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
    };
    await this.db.insert(s.tasks).values(values).onConflictDoUpdate({ target: s.tasks.id, set: values });
  }
}

/* ------------------------------------------------------------------ */
/** Persisted worktrees. `dirty` is live git state: callers compute it, it is never stored. */
export class WorktreeRepo {
  constructor(private db: Database) {}
  private hydrate(row: typeof s.worktrees.$inferSelect): Worktree {
    return WorktreeSchema.parse({ ...row, dirty: false });
  }
  async list(filter: { workspaceId?: string | undefined; taskId?: string | undefined } = {}): Promise<Worktree[]> {
    const conds = [];
    if (filter.workspaceId) conds.push(eq(s.worktrees.workspaceId, filter.workspaceId));
    if (filter.taskId) conds.push(eq(s.worktrees.taskId, filter.taskId));
    const rows = await this.db
      .select()
      .from(s.worktrees)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(s.worktrees.createdAt));
    return rows.map((r) => this.hydrate(r));
  }
  async get(id: string): Promise<Worktree | null> {
    const row = (await this.db.select().from(s.worktrees).where(eq(s.worktrees.id, id)))[0];
    return row ? this.hydrate(row) : null;
  }
  /** The worktree of a task lane: one per (task, repository), or per subtask in parallel modes. */
  async findLane(taskId: string, repositoryId: string, subtaskId: string | null): Promise<Worktree | null> {
    const row = (
      await this.db
        .select()
        .from(s.worktrees)
        .where(
          and(
            eq(s.worktrees.taskId, taskId),
            eq(s.worktrees.repositoryId, repositoryId),
            subtaskId ? eq(s.worktrees.subtaskId, subtaskId) : isNull(s.worktrees.subtaskId),
          ),
        )
    )[0];
    return row ? this.hydrate(row) : null;
  }
  async insert(w: Worktree): Promise<void> {
    const { dirty: _dirty, ...values } = w;
    await this.db.insert(s.worktrees).values(values);
  }
  async delete(id: string): Promise<void> {
    await this.db.delete(s.worktrees).where(eq(s.worktrees.id, id));
  }
}

/* ------------------------------------------------------------------ */
export class SessionRepo {
  constructor(private db: Database) {}
  private hydrate(row: typeof s.agentSessions.$inferSelect): AgentSession {
    return AgentSessionSchema.parse(row);
  }
  async list(filter: { workspaceId?: string | undefined; taskId?: string | undefined; statuses?: string[] | undefined } = {}): Promise<AgentSession[]> {
    const conds = [];
    if (filter.workspaceId) conds.push(eq(s.agentSessions.workspaceId, filter.workspaceId));
    if (filter.taskId) conds.push(eq(s.agentSessions.taskId, filter.taskId));
    if (filter.statuses?.length) conds.push(inArray(s.agentSessions.status, filter.statuses));
    const rows = await this.db
      .select()
      .from(s.agentSessions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.agentSessions.lastActivityAt));
    return rows.map((r) => this.hydrate(r));
  }
  async get(id: string): Promise<AgentSession | null> {
    const row = (await this.db.select().from(s.agentSessions).where(eq(s.agentSessions.id, id)))[0];
    return row ? this.hydrate(row) : null;
  }
  async upsert(session: AgentSession): Promise<void> {
    await this.db.insert(s.agentSessions).values(session).onConflictDoUpdate({ target: s.agentSessions.id, set: session });
  }

  async appendEntry(entry: SessionEntry): Promise<void> {
    await this.db.insert(s.sessionEntries).values({
      id: entry.id,
      sessionId: entry.sessionId,
      seq: entry.seq,
      kind: entry.kind,
      payload: json(entry),
      createdAt: entry.at,
    });
  }
  async updateEntry(entry: SessionEntry): Promise<void> {
    await this.db.update(s.sessionEntries).set({ payload: json(entry), kind: entry.kind }).where(eq(s.sessionEntries.id, entry.id));
  }
  async entries(sessionId: string, afterSeq = 0, limit = 2000): Promise<SessionEntry[]> {
    const rows = await this.db
      .select()
      .from(s.sessionEntries)
      .where(and(eq(s.sessionEntries.sessionId, sessionId), gt(s.sessionEntries.seq, afterSeq)))
      .orderBy(asc(s.sessionEntries.seq))
      .limit(limit);
    return rows.map((r) => SessionEntrySchema.parse(parse(r.payload, {})));
  }
  async lastSeq(sessionId: string): Promise<number> {
    const row = (await this.db.select({ m: sql<number>`coalesce(max(${s.sessionEntries.seq}), 0)` }).from(s.sessionEntries).where(eq(s.sessionEntries.sessionId, sessionId)))[0];
    return Number(row?.m ?? 0);
  }
}

/* ------------------------------------------------------------------ */
export class ApprovalRepo {
  constructor(private db: Database) {}
  private hydrate(row: typeof s.approvalRequests.$inferSelect): ApprovalRequest {
    return ApprovalRequestSchema.parse({ ...row, input: parse(row.input, {}), affected: parse(row.affected, []) });
  }
  async list(filter: { status?: string | undefined; workspaceId?: string | undefined } = {}): Promise<ApprovalRequest[]> {
    const conds = [];
    if (filter.status) conds.push(eq(s.approvalRequests.status, filter.status));
    if (filter.workspaceId) conds.push(eq(s.approvalRequests.workspaceId, filter.workspaceId));
    const rows = await this.db
      .select()
      .from(s.approvalRequests)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.approvalRequests.createdAt));
    return rows.map((r) => this.hydrate(r));
  }
  async get(id: string): Promise<ApprovalRequest | null> {
    const row = (await this.db.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, id)))[0];
    return row ? this.hydrate(row) : null;
  }
  async upsert(a: ApprovalRequest): Promise<void> {
    const values = { ...a, input: json(a.input), affected: json(a.affected) };
    await this.db.insert(s.approvalRequests).values(values).onConflictDoUpdate({ target: s.approvalRequests.id, set: values });
  }
}

/* ------------------------------------------------------------------ */
export class EventRepo {
  constructor(private db: Database) {}
  async append(event: { id: string; type: string; at: string }, payload: unknown): Promise<number> {
    const res = await this.db.insert(s.events).values({ id: event.id, type: event.type, payload: json(payload), createdAt: event.at }).returning({ seq: s.events.seq });
    return Number(res[0]?.seq ?? 0);
  }
  async after(seq: number, limit = 500): Promise<{ seq: number; payload: unknown }[]> {
    const rows = await this.db.select().from(s.events).where(gt(s.events.seq, seq)).orderBy(asc(s.events.seq)).limit(limit);
    return rows.map((r) => ({ seq: r.seq, payload: parse(r.payload, null) }));
  }
  async lastSeq(): Promise<number> {
    const row = (await this.db.select({ m: sql<number>`coalesce(max(${s.events.seq}), 0)` }).from(s.events))[0];
    return Number(row?.m ?? 0);
  }
}

export class SettingsRepo {
  constructor(private db: Database) {}
  async get<T>(key: string, fallback: T): Promise<T> {
    const row = (await this.db.select().from(s.settings).where(eq(s.settings.key, key)))[0];
    return row ? parse<T>(row.value, fallback) : fallback;
  }
  async set(key: string, value: unknown): Promise<void> {
    const v = { key, value: json(value), updatedAt: new Date().toISOString() };
    await this.db.insert(s.settings).values(v).onConflictDoUpdate({ target: s.settings.key, set: v });
  }
}
