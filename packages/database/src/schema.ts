import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const machines = sqliteTable('machines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  runtimeVersion: text('runtime_version').notNull(),
  createdAt: text('created_at').notNull(),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  machineId: text('machine_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  type: text('type').notNull(),
  defaultProvider: text('default_provider').notNull().default('claude-code'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    defaultBranch: text('default_branch').notNull(),
    remoteUrl: text('remote_url'),
    /** JSON array of Service */
    services: text('services').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('repositories_workspace_idx').on(t.workspaceId)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    ticketId: text('ticket_id'),
    ticketKey: text('ticket_key'),
    title: text('title').notNull(),
    objective: text('objective').notNull().default(''),
    status: text('status').notNull(),
    orchestration: text('orchestration').notNull().default('single'),
    isolation: text('isolation').notNull().default('worktree'),
    /** JSON array of repository ids */
    repositoryIds: text('repository_ids').notNull().default('[]'),
    /** JSON array of Subtask */
    subtasks: text('subtasks').notNull().default('[]'),
    progress: integer('progress').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  (t) => [index('tasks_workspace_idx').on(t.workspaceId), index('tasks_status_idx').on(t.status)],
);

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    taskId: text('task_id'),
    subtaskId: text('subtask_id'),
    repositoryId: text('repository_id'),
    worktreeId: text('worktree_id'),
    provider: text('provider').notNull(),
    role: text('role').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    providerSessionId: text('provider_session_id'),
    cwd: text('cwd').notNull(),
    model: text('model'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
  },
  (t) => [index('sessions_workspace_idx').on(t.workspaceId), index('sessions_task_idx').on(t.taskId), index('sessions_status_idx').on(t.status)],
);

export const sessionEntries = sqliteTable(
  'session_entries',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    /** Full SessionEntry JSON (kind-specific payload). */
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('entries_session_seq_idx').on(t.sessionId, t.seq)],
);

export const approvalRequests = sqliteTable(
  'approval_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    taskId: text('task_id'),
    workspaceId: text('workspace_id').notNull(),
    provider: text('provider').notNull(),
    providerRequestId: text('provider_request_id').notNull(),
    tool: text('tool').notNull(),
    input: text('input').notNull(),
    summary: text('summary').notNull(),
    affected: text('affected').notNull().default('[]'),
    risk: text('risk').notNull(),
    reason: text('reason'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    resolvedAt: text('resolved_at'),
    decidedBy: text('decided_by'),
  },
  (t) => [index('approvals_status_idx').on(t.status), index('approvals_session_idx').on(t.sessionId)],
);

export const worktrees = sqliteTable(
  'worktrees',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().default(''),
    repositoryId: text('repository_id').notNull(),
    taskId: text('task_id'),
    subtaskId: text('subtask_id'),
    path: text('path').notNull(),
    branch: text('branch').notNull(),
    baseBranch: text('base_branch').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('worktrees_task_idx').on(t.taskId), index('worktrees_workspace_idx').on(t.workspaceId)],
);

/** Persistent, append-only event log used for UI sync, remote replay and audit. */
export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('events_type_idx').on(t.type)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
