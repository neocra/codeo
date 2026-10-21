import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Identifiers                                                          */
/* ------------------------------------------------------------------ */
export const IdSchema = z.string().min(3);
export const IsoDateSchema = z.string().datetime({ offset: true }).or(z.string().datetime());

/* ------------------------------------------------------------------ */
/* Machines                                                             */
/* ------------------------------------------------------------------ */
export const PlatformSchema = z.enum(['darwin', 'win32', 'linux']);
export type Platform = z.infer<typeof PlatformSchema>;

export const MachineSchema = z.object({
  id: IdSchema,
  name: z.string(),
  platform: PlatformSchema,
  runtimeVersion: z.string(),
  connection: z.enum(['local', 'ssh', 'gateway']),
  status: z.enum(['connected', 'disconnected']),
});
export type Machine = z.infer<typeof MachineSchema>;

/* ------------------------------------------------------------------ */
/* Workspace / Repository / Service                                     */
/* ------------------------------------------------------------------ */
export const WorkspaceTypeSchema = z.enum(['monorepo', 'multi-repo']);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

export const ServiceSchema = z.object({
  id: IdSchema,
  repositoryId: IdSchema,
  name: z.string(),
  /** Path relative to the repository root, e.g. `apps/web`. */
  path: z.string(),
  dependsOn: z.array(IdSchema).default([]),
});
export type Service = z.infer<typeof ServiceSchema>;

export const RepositorySchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string(),
  /** Absolute path on the machine that owns the workspace. */
  path: z.string(),
  defaultBranch: z.string(),
  remoteUrl: z.string().nullable(),
  services: z.array(ServiceSchema).default([]),
  createdAt: IsoDateSchema,
});
export type Repository = z.infer<typeof RepositorySchema>;

/**
 * How autonomously an agent runs. Codeo orchestrates each provider's NATIVE
 * capabilities — it never replaces them with a custom permission engine:
 *  - `manual`: every sensitive action needs a human decision (Claude `permissionMode:'default'`
 *    routed through Codeo approvals; Codex `sandboxMode:'read-only'`).
 *  - `auto`: the agent acts on its own, only actions the provider cannot clear itself escalate
 *    (Claude `permissionMode:'auto'`, its classifier-based auto mode; Codex `sandboxMode:'workspace-write'`).
 *  - `full`: explicit opt-in unattended execution (Claude `permissionMode:'bypassPermissions'`;
 *    Codex `sandboxMode:'danger-full-access'`).
 */
export const ExecutionModeSchema = z.enum(['manual', 'auto', 'full']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

/**
 * The mode a provider effectively ran under before execution modes existed: Claude Code used
 * `permissionMode:'default'` (= `manual`), Codex `sandboxMode:'workspace-write'` (= `auto`).
 * Records serialized without the field keep that policy instead of silently changing it.
 */
export function legacyExecutionMode(provider: string): ExecutionMode {
  return provider === 'claude-code' ? 'manual' : 'auto';
}

/** Fills a missing `executionMode` from the record's `provider` (see `legacyExecutionMode`). */
const withLegacyExecutionMode = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || 'executionMode' in value) return value;
  const provider = (value as { provider?: unknown }).provider;
  return typeof provider === 'string' ? { ...value, executionMode: legacyExecutionMode(provider) } : value;
};

export const WorkspaceSchema = z.object({
  id: IdSchema,
  machineId: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  type: WorkspaceTypeSchema,
  repositories: z.array(RepositorySchema).default([]),
  defaultProvider: z.enum(['claude-code', 'codex']).default('claude-code'),
  defaultExecutionMode: ExecutionModeSchema.default('auto'),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/* ------------------------------------------------------------------ */
/* Tickets                                                              */
/* ------------------------------------------------------------------ */
export const TicketSourceSchema = z.enum(['jira', 'github', 'manual']);
export const TicketStatusSchema = z.enum(['backlog', 'in_progress', 'review', 'pr_open', 'done']);
export const TicketSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  source: TicketSourceSchema,
  /** External key such as `PROJ-123` or `#42`. */
  key: z.string(),
  title: z.string(),
  description: z.string().default(''),
  status: TicketStatusSchema,
  url: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

/* ------------------------------------------------------------------ */
/* Agents                                                               */
/* ------------------------------------------------------------------ */
export const AgentProviderIdSchema = z.enum(['claude-code', 'codex']);
export type AgentProviderId = z.infer<typeof AgentProviderIdSchema>;

export const AgentRoleSchema = z.enum([
  'planner',
  'architect',
  'backend',
  'frontend',
  'qa',
  'reviewer',
  'devops',
  'developer',
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

/** Assignments serialized before unified auto mode (in `tasks.subtasks`) keep their provider's former policy. */
export const AgentAssignmentSchema = z.preprocess(
  withLegacyExecutionMode,
  z.object({
    role: AgentRoleSchema,
    provider: AgentProviderIdSchema,
    model: z.string().nullable().default(null),
    executionMode: ExecutionModeSchema,
  }),
);
export type AgentAssignment = z.infer<typeof AgentAssignmentSchema>;

/* ------------------------------------------------------------------ */
/* Tasks / Subtasks                                                     */
/* ------------------------------------------------------------------ */
export const TaskStatusSchema = z.enum([
  'draft',
  'queued',
  'running',
  'waiting_approval',
  'paused',
  'review',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const OrchestrationModeSchema = z.enum(['single', 'sequential', 'parallel', 'pipeline', 'best-of-n']);
export type OrchestrationMode = z.infer<typeof OrchestrationModeSchema>;

/** `worktree`: every agent works in an isolated Git worktree; `none`: agents work in the repository itself. */
export const TaskIsolationSchema = z.enum(['worktree', 'none']);
export type TaskIsolation = z.infer<typeof TaskIsolationSchema>;

export const SubtaskStatusSchema = z.enum(['pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled']);
export type SubtaskStatus = z.infer<typeof SubtaskStatusSchema>;
export const SubtaskSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  title: z.string(),
  instructions: z.string(),
  assignment: AgentAssignmentSchema,
  repositoryId: IdSchema.nullable().default(null),
  dependsOn: z.array(IdSchema).default([]),
  status: SubtaskStatusSchema,
  sessionId: IdSchema.nullable().default(null),
  worktreeId: IdSchema.nullable().default(null),
  order: z.number().int(),
  /** Provider or launch error when the subtask failed; kept so the task's final failure reports it. */
  error: z.string().nullable().default(null),
  /** Start of the current attempt: crash recovery only adopts sessions created after it (a retry detaches older ones). */
  attemptStartedAt: IsoDateSchema.nullable().default(null),
});
export type Subtask = z.infer<typeof SubtaskSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  ticketId: IdSchema.nullable().default(null),
  ticketKey: z.string().nullable().default(null),
  title: z.string().min(1),
  objective: z.string().default(''),
  status: TaskStatusSchema,
  orchestration: OrchestrationModeSchema.default('single'),
  /** Serialized tasks without the field predate worktree isolation (migration 0001 marks them 'none'); new tasks are persisted explicitly. */
  isolation: TaskIsolationSchema.default('none'),
  /**
   * Default execution mode for subtasks that don't override it — only read when the task is created.
   * What actually runs is each subtask's `assignment.executionMode` (legacy assignments keep their former policy).
   */
  executionMode: ExecutionModeSchema.default('auto'),
  repositoryIds: z.array(IdSchema).default([]),
  subtasks: z.array(SubtaskSchema).default([]),
  progress: z.number().min(0).max(100).default(0),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  startedAt: IsoDateSchema.nullable().default(null),
  completedAt: IsoDateSchema.nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;

/* ------------------------------------------------------------------ */
/* Worktrees                                                            */
/* ------------------------------------------------------------------ */
export const WorktreeSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  repositoryId: IdSchema,
  taskId: IdSchema.nullable(),
  /** Set when the worktree belongs to one subtask (parallel modes); null when shared by the task's steps. */
  subtaskId: IdSchema.nullable().default(null),
  path: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  dirty: z.boolean().default(false),
  createdAt: IsoDateSchema,
});
export type Worktree = z.infer<typeof WorktreeSchema>;

/* ------------------------------------------------------------------ */
/* Sessions                                                             */
/* ------------------------------------------------------------------ */
export const SessionStatusSchema = z.enum([
  'created',
  'running',
  'waiting_approval',
  'idle',
  'completed',
  'failed',
  'cancelled',
  'disconnected',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const AgentSessionSchema = z.preprocess(withLegacyExecutionMode, z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  taskId: IdSchema.nullable().default(null),
  subtaskId: IdSchema.nullable().default(null),
  repositoryId: IdSchema.nullable().default(null),
  worktreeId: IdSchema.nullable().default(null),
  provider: AgentProviderIdSchema,
  role: AgentRoleSchema,
  title: z.string(),
  status: SessionStatusSchema,
  /** Provider-side session/thread identifier used to resume. */
  providerSessionId: z.string().nullable().default(null),
  cwd: z.string(),
  model: z.string().nullable().default(null),
  /** Sessions serialized before unified auto mode keep their provider's former policy (migration 0002 backfills rows). */
  executionMode: ExecutionModeSchema,
  error: z.string().nullable().default(null),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lastActivityAt: IsoDateSchema,
}));
export type AgentSession = z.infer<typeof AgentSessionSchema>;

/** Normalised transcript entries — independent of provider wire formats. */
export const SessionEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user_message'), id: IdSchema, sessionId: IdSchema, seq: z.number().int(), at: IsoDateSchema, text: z.string() }),
  z.object({ kind: z.literal('assistant_text'), id: IdSchema, sessionId: IdSchema, seq: z.number().int(), at: IsoDateSchema, text: z.string(), streaming: z.boolean().default(false) }),
  z.object({ kind: z.literal('thinking'), id: IdSchema, sessionId: IdSchema, seq: z.number().int(), at: IsoDateSchema, text: z.string() }),
  z.object({
    kind: z.literal('tool_call'),
    id: IdSchema,
    sessionId: IdSchema,
    seq: z.number().int(),
    at: IsoDateSchema,
    toolUseId: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    status: z.enum(['running', 'completed', 'failed', 'denied']).default('running'),
    output: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal('system'),
    id: IdSchema,
    sessionId: IdSchema,
    seq: z.number().int(),
    at: IsoDateSchema,
    text: z.string(),
    level: z.enum(['info', 'warn', 'error']).default('info'),
    /** Stable key (`session.system.<key>` in i18n) so clients can translate; `text` is the French fallback. */
    key: z.string().nullable().default(null),
    params: z.record(z.string(), z.union([z.string(), z.number()])).nullable().default(null),
  }),
  z.object({
    kind: z.literal('result'),
    id: IdSchema,
    sessionId: IdSchema,
    seq: z.number().int(),
    at: IsoDateSchema,
    ok: z.boolean(),
    summary: z.string(),
    durationMs: z.number().int().nullable().default(null),
    costUsd: z.number().nullable().default(null),
    turns: z.number().int().nullable().default(null),
  }),
]);
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

/* ------------------------------------------------------------------ */
/* Approvals                                                            */
/* ------------------------------------------------------------------ */
export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']);
export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export const ApprovalRequestSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  taskId: IdSchema.nullable().default(null),
  workspaceId: IdSchema,
  provider: AgentProviderIdSchema,
  /** Provider request id (toolUseID for Claude Code) to correlate the decision. */
  providerRequestId: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  /** Human-readable summary: "Modifier src/foo.ts", "Exécuter `pnpm test`"… */
  summary: z.string(),
  affected: z.array(z.string()).default([]),
  risk: RiskLevelSchema,
  reason: z.string().nullable().default(null),
  status: ApprovalStatusSchema,
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  resolvedAt: IsoDateSchema.nullable().default(null),
  decidedBy: z.enum(['desktop', 'mobile', 'policy', 'system']).nullable().default(null),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/* ------------------------------------------------------------------ */
/* Pull requests / CI                                                   */
/* ------------------------------------------------------------------ */
export const CICheckSchema = z.object({
  id: IdSchema,
  pullRequestId: IdSchema,
  name: z.string(),
  status: z.enum(['queued', 'running', 'success', 'failure', 'cancelled']),
  url: z.string().nullable().default(null),
  updatedAt: IsoDateSchema,
});
export type CICheck = z.infer<typeof CICheckSchema>;

export const PullRequestStatusSchema = z.enum(['draft', 'open', 'changes_requested', 'approved', 'merged', 'closed']);
export const PullRequestSchema = z.object({
  id: IdSchema,
  repositoryId: IdSchema,
  taskId: IdSchema.nullable().default(null),
  ticketId: IdSchema.nullable().default(null),
  number: z.number().int(),
  title: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  url: z.string(),
  status: PullRequestStatusSchema,
  additions: z.number().int().default(0),
  deletions: z.number().int().default(0),
  checks: z.array(CICheckSchema).default([]),
  dependsOn: z.array(IdSchema).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

/* ------------------------------------------------------------------ */
/* Plugins                                                              */
/* ------------------------------------------------------------------ */
export const PluginKindSchema = z.enum(['ticket-provider', 'git-provider', 'agent-provider', 'notification-provider', 'custom-view']);
export const PluginPermissionSchema = z.enum(['network', 'credentials:own', 'workspace:read', 'workspace:write', 'ui:view']);
export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  kind: PluginKindSchema,
  capabilities: z.array(z.string()),
  permissions: z.array(PluginPermissionSchema),
  configSchema: z.record(z.string(), z.unknown()).default({}),
  entry: z.string(),
  compatibility: z.string(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/* ------------------------------------------------------------------ */
/* Remote devices                                                       */
/* ------------------------------------------------------------------ */
export const RemoteDeviceSchema = z.object({
  id: IdSchema,
  name: z.string(),
  platform: z.enum(['ios', 'android']),
  pairedAt: IsoDateSchema,
  lastSeenAt: IsoDateSchema.nullable().default(null),
  revoked: z.boolean().default(false),
});
export type RemoteDevice = z.infer<typeof RemoteDeviceSchema>;
