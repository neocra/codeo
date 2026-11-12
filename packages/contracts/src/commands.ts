import { z } from 'zod';
import { PROTOCOL_VERSION } from './version';
import {
  AgentProviderIdSchema,
  IdSchema,
  AgentRoleSchema,
  AgentSessionSchema,
  ApprovalRequestSchema,
  ExecutionModeSchema,
  MachineSchema,
  OrchestrationModeSchema,
  ProviderStatusSchema,
  PullRequestSchema,
  SessionEntrySchema,
  TaskIsolationSchema,
  TaskSchema,
  WorkspaceSchema,
  WorkspaceTypeSchema,
  WorktreeSchema,
} from '@codeo/domain';

/**
 * Every runtime command: params schema, result schema, and the authorization scope
 * a remote caller needs. Desktop (local, trusted) callers hold every scope; paired
 * mobile devices receive a subset at pairing time.
 */
export const CommandScopeSchema = z.enum([
  'read',
  'session:write',
  'approval:decide',
  'workspace:admin',
]);
export type CommandScope = z.infer<typeof CommandScopeSchema>;

const define = <P extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  params: P,
  result: R,
  scope: CommandScope,
) => ({
  params,
  result,
  scope,
});

export const RepositoryInspectionSchema = z.object({
  path: z.string(),
  isGitRepository: z.boolean(),
  root: z.string().nullable(),
  name: z.string(),
  currentBranch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  dirty: z.boolean(),
  worktrees: z.array(
    z.object({ path: z.string(), branch: z.string().nullable(), head: z.string() }),
  ),
});
export type RepositoryInspection = z.infer<typeof RepositoryInspectionSchema>;

export const RuntimeInfoSchema = z.object({
  version: z.string(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  machine: MachineSchema,
  dataDir: z.string(),
  startedAt: z.string(),
  demoMode: z.boolean(),
});
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

export const HomeSummarySchema = z.object({
  workspace: WorkspaceSchema.nullable(),
  activeSessions: z.array(AgentSessionSchema),
  recentSessions: z.array(AgentSessionSchema),
  pendingApprovals: z.array(ApprovalRequestSchema),
  activeTasks: z.array(TaskSchema),
  recentFailures: z.array(AgentSessionSchema),
  /** Pull requests GitHub can still change (not merged or closed), newest first. */
  openPullRequests: z.array(PullRequestSchema).default([]),
});
export type HomeSummary = z.infer<typeof HomeSummarySchema>;

/** One agent of a task plan. `dependsOn` holds indexes of earlier entries (ids do not exist yet). */
export const SubtaskPlanSchema = z.object({
  title: z.string().max(200).default(''),
  instructions: z.string().max(20_000).default(''),
  provider: AgentProviderIdSchema,
  role: AgentRoleSchema.default('developer'),
  model: z.string().nullable().default(null),
  executionMode: ExecutionModeSchema.optional(),
  repositoryId: IdSchema.nullable().default(null),
  dependsOn: z.array(z.number().int().min(0)).default([]),
});
export type SubtaskPlan = z.infer<typeof SubtaskPlanSchema>;

/** A worktree's changes against its base branch (commits + uncommitted work, untracked files included). */
export const DiffLineSchema = z.object({
  type: z.enum(['add', 'del', 'ctx']),
  old: z.number().int().nullable(),
  new: z.number().int().nullable(),
  text: z.string(),
});
export const FileDiffSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'deleted', 'modified', 'renamed']),
  binary: z.boolean(),
  additions: z.number().int(),
  deletions: z.number().int(),
  hunks: z.array(z.object({ header: z.string(), lines: z.array(DiffLineSchema) })),
  truncated: z.boolean(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;
export const WorktreeDiffSchema = z.object({
  worktreeId: IdSchema,
  branch: z.string(),
  baseBranch: z.string(),
  mergeBase: z.string(),
  head: z.string(),
  commits: z.number().int(),
  uncommitted: z.boolean(),
  files: z.array(FileDiffSchema),
  additions: z.number().int(),
  deletions: z.number().int(),
  truncated: z.boolean(),
});
export type WorktreeDiff = z.infer<typeof WorktreeDiffSchema>;

/** A reviewer's note anchored on one line of a worktree diff (`side`: the new file, or the old one for a deleted line). */
export const ReviewCommentSchema = z.object({
  path: z.string().min(1).max(1000),
  line: z.number().int().positive(),
  side: z.enum(['new', 'old']),
  /** The commented line as shown in the diff, so the agent sees what the reviewer saw. */
  excerpt: z.string().max(1000).default(''),
  body: z.string().trim().min(1).max(5000),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const GitHubStatusSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  authenticated: z.boolean(),
  detail: z.string().nullable(),
});
export type GitHubStatus = z.infer<typeof GitHubStatusSchema>;

/** Remote access through the Codeo gateway (phase 6): the runtime dials out, phones are paired by QR code. */
export const RemoteConnectionSchema = z.enum([
  /** Remote access is off: nothing dials out. */
  'disabled',
  /** Dialling the gateway (first attempt or reconnecting after a drop). */
  'connecting',
  /** The gateway relays phone requests to this runtime. */
  'connected',
  /** The gateway cannot be reached; retried with backoff. */
  'offline',
  /** The gateway refused this runtime's secret (deleted, or another gateway): enable again to re-register. */
  'unauthorized',
]);
export type RemoteConnection = z.infer<typeof RemoteConnectionSchema>;

export const RemoteStatusSchema = z.object({
  enabled: z.boolean(),
  gatewayUrl: z.string().nullable(),
  /** The id the gateway gave this runtime at registration (never the secret). */
  runtimeId: z.string().nullable(),
  connection: RemoteConnectionSchema,
  connectedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type RemoteStatus = z.infer<typeof RemoteStatusSchema>;

export const RemotePairingSchema = z.object({
  /** 6 digits, single use, for manual entry on the phone. */
  code: z.string(),
  expiresAt: z.string(),
  /** JSON payload `{ v, gateway, code, runtimeId, nonce }` the desktop renders as a QR code. */
  qrPayload: z.string(),
});
export type RemotePairing = z.infer<typeof RemotePairingSchema>;

export const PairedDeviceSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  platform: z.enum(['ios', 'android']),
  scopes: z.array(CommandScopeSchema),
  pairedAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revoked: z.boolean(),
  revokedAt: z.string().nullable(),
  connected: z.boolean(),
});
export type PairedDevice = z.infer<typeof PairedDeviceSchema>;

export const commands = {
  'runtime.info': define(z.object({}), RuntimeInfoSchema, 'read'),

  'providers.list': define(
    z.object({ refresh: z.boolean().default(false) }),
    z.array(ProviderStatusSchema),
    'read',
  ),

  'repositories.inspect': define(
    z.object({ path: z.string().min(1) }),
    RepositoryInspectionSchema,
    'workspace:admin',
  ),

  'workspaces.list': define(z.object({}), z.array(WorkspaceSchema), 'read'),
  'workspaces.create': define(
    z.object({
      name: z.string().min(1).max(120),
      type: WorkspaceTypeSchema,
      description: z.string().max(500).default(''),
      repositoryPaths: z.array(z.string().min(1)).min(1),
      defaultExecutionMode: ExecutionModeSchema.optional(),
    }),
    WorkspaceSchema,
    'workspace:admin',
  ),
  'workspaces.update': define(
    z.object({ workspaceId: IdSchema, defaultExecutionMode: ExecutionModeSchema }),
    WorkspaceSchema,
    'workspace:admin',
  ),
  'workspaces.addRepository': define(
    z.object({ workspaceId: IdSchema, path: z.string().min(1) }),
    WorkspaceSchema,
    'workspace:admin',
  ),
  'workspaces.removeRepository': define(
    z.object({ workspaceId: IdSchema, repositoryId: IdSchema }),
    WorkspaceSchema,
    'workspace:admin',
  ),
  'workspaces.delete': define(
    z.object({ workspaceId: IdSchema }),
    z.object({ deleted: z.boolean() }),
    'workspace:admin',
  ),

  'tasks.list': define(z.object({ workspaceId: IdSchema.optional() }), z.array(TaskSchema), 'read'),
  'tasks.get': define(z.object({ taskId: IdSchema }), TaskSchema, 'read'),
  'tasks.create': define(
    z.object({
      workspaceId: IdSchema,
      title: z.string().min(1).max(200),
      objective: z.string().max(20_000).default(''),
      ticketKey: z.string().max(40).nullable().default(null),
      repositoryIds: z.array(IdSchema).default([]),
      /** Default agent; also the single agent when `subtasks` is empty. */
      provider: AgentProviderIdSchema,
      role: AgentRoleSchema.default('developer'),
      model: z.string().nullable().default(null),
      orchestration: OrchestrationModeSchema.default('single'),
      isolation: TaskIsolationSchema.default('worktree'),
      /** Default execution mode for this task's agents; falls back to the workspace default when omitted. */
      executionMode: ExecutionModeSchema.optional(),
      subtasks: z.array(SubtaskPlanSchema).max(8).default([]),
    }),
    TaskSchema,
    'session:write',
  ),
  /** Starts (or retries) a task; returns the sessions launched right away (later steps start as dependencies complete). */
  'tasks.start': define(
    z.object({ taskId: IdSchema }),
    z.object({ task: TaskSchema, sessions: z.array(AgentSessionSchema) }),
    'session:write',
  ),
  /**
   * Closes the human review: the task moves `review` → `completed` and its idle agents are released.
   * Best-of-N requires the kept candidate (`winnerSubtaskId`, a completed subtask); other modes refuse one.
   * Worktrees and branches are kept (the PR flow works from them).
   */
  'tasks.complete': define(
    z.object({ taskId: IdSchema, winnerSubtaskId: IdSchema.optional() }),
    TaskSchema,
    'session:write',
  ),
  /**
   * Sends a reviewed lane back to its agent: general feedback and/or inline diff comments become the agent's next turn
   * in its own session and worktree. The task moves `review` → `running` and returns to `review` when the agent is done.
   * `subtaskId` is required when the task has several lanes that can be revised (parallel lanes, Best-of-N candidates).
   */
  'tasks.requestChanges': define(
    z
      .object({
        taskId: IdSchema,
        subtaskId: IdSchema.optional(),
        feedback: z.string().trim().max(20_000).default(''),
        comments: z.array(ReviewCommentSchema).max(100).default([]),
      })
      .refine((p) => p.feedback.length > 0 || p.comments.length > 0, {
        message: 'feedback or comments required',
        path: ['feedback'],
      }),
    z.object({ task: TaskSchema, session: AgentSessionSchema }),
    'session:write',
  ),
  'tasks.cancel': define(z.object({ taskId: IdSchema }), TaskSchema, 'session:write'),
  'tasks.pause': define(z.object({ taskId: IdSchema }), TaskSchema, 'session:write'),
  'tasks.resume': define(z.object({ taskId: IdSchema }), TaskSchema, 'session:write'),

  'worktrees.list': define(
    z.object({ workspaceId: IdSchema.optional(), taskId: IdSchema.optional() }),
    z.array(WorktreeSchema),
    'read',
  ),
  'worktrees.diff': define(z.object({ worktreeId: IdSchema }), WorktreeDiffSchema, 'read'),
  /** Removes a worktree directory (its branch is kept). Refused while dirty unless `force`, and while an agent works in it. */
  'worktrees.remove': define(
    z.object({ worktreeId: IdSchema, force: z.boolean().default(false) }),
    z.object({ removed: z.boolean() }),
    'workspace:admin',
  ),

  /** Whether the user's GitHub CLI is installed and logged in (pull requests are opened with it). */
  'github.status': define(z.object({}), GitHubStatusSchema, 'read'),
  'pullRequests.list': define(
    z.object({ workspaceId: IdSchema.optional(), taskId: IdSchema.optional() }),
    z.array(PullRequestSchema),
    'read',
  ),
  /**
   * Publishes a completed task: commits each kept worktree (Best-of-N: the winner's), pushes its branch (never
   * forced) and opens a PR with `gh`, or adopts the one already open for the branch. `skipped`: worktrees with no work.
   */
  'pullRequests.create': define(
    z.object({
      taskId: IdSchema,
      title: z.string().max(256).optional(),
      body: z.string().max(60_000).optional(),
      draft: z.boolean().default(false),
    }),
    z.object({ pullRequests: z.array(PullRequestSchema), skipped: z.array(IdSchema) }),
    'workspace:admin',
  ),
  /** Re-reads a PR's status and CI checks from GitHub. */
  'pullRequests.refresh': define(z.object({ pullRequestId: IdSchema }), PullRequestSchema, 'read'),

  'sessions.list': define(
    z.object({ workspaceId: IdSchema.optional(), taskId: IdSchema.optional() }),
    z.array(AgentSessionSchema),
    'read',
  ),
  'sessions.get': define(
    z.object({ sessionId: IdSchema, afterSeq: z.number().int().default(0) }),
    z.object({ session: AgentSessionSchema, entries: z.array(SessionEntrySchema) }),
    'read',
  ),
  'sessions.start': define(
    z.object({
      workspaceId: IdSchema,
      repositoryId: IdSchema.nullable().default(null),
      provider: AgentProviderIdSchema,
      role: AgentRoleSchema.default('developer'),
      title: z.string().max(200).optional(),
      prompt: z.string().min(1).max(50_000),
      model: z.string().nullable().default(null),
      executionMode: ExecutionModeSchema.optional(),
    }),
    AgentSessionSchema,
    'session:write',
  ),
  'sessions.send': define(
    z.object({ sessionId: IdSchema, text: z.string().min(1).max(50_000) }),
    AgentSessionSchema,
    'session:write',
  ),
  'sessions.cancel': define(z.object({ sessionId: IdSchema }), AgentSessionSchema, 'session:write'),

  'approvals.list': define(
    z.object({
      status: ApprovalRequestSchema.shape.status.optional(),
      workspaceId: IdSchema.optional(),
    }),
    z.array(ApprovalRequestSchema),
    'read',
  ),
  'approvals.resolve': define(
    z.object({
      approvalId: IdSchema,
      decision: z.enum(['approve', 'reject']),
      reason: z.string().max(500).optional(),
    }),
    ApprovalRequestSchema,
    'approval:decide',
  ),

  /* Remote access: settings change only from a local client (`workspace:admin` is never granted remotely). */
  'remote.status': define(z.object({}), RemoteStatusSchema, 'read'),
  'remote.enable': define(z.object({ gatewayUrl: z.url({ protocol: /^https?$/ }).max(500) }), RemoteStatusSchema, 'workspace:admin'),
  'remote.disable': define(z.object({}), RemoteStatusSchema, 'workspace:admin'),
  'remote.pairingStart': define(z.object({}), RemotePairingSchema, 'workspace:admin'),
  'remote.devices': define(z.object({}), z.array(PairedDeviceSchema), 'workspace:admin'),
  'remote.revokeDevice': define(z.object({ deviceId: z.string().min(3).max(80) }), z.object({ deviceId: z.string(), revoked: z.boolean() }), 'workspace:admin'),

  'home.summary': define(z.object({ workspaceId: IdSchema.optional() }), HomeSummarySchema, 'read'),
} as const;

export type CommandName = keyof typeof commands;
export type CommandParams<C extends CommandName> = z.input<(typeof commands)[C]['params']>;
export type CommandParsedParams<C extends CommandName> = z.output<(typeof commands)[C]['params']>;
export type CommandResult<C extends CommandName> = z.output<(typeof commands)[C]['result']>;

export const CommandNameSchema = z.enum(Object.keys(commands) as [CommandName, ...CommandName[]]);
