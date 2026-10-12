import { z } from 'zod';
import { PROTOCOL_VERSION } from './version';
import {
  AgentProviderIdSchema,
  IdSchema,
  AgentRoleSchema,
  AgentSessionSchema,
  ApprovalRequestSchema,
  MachineSchema,
  OrchestrationModeSchema,
  ProviderStatusSchema,
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
});
export type HomeSummary = z.infer<typeof HomeSummarySchema>;

/** One agent of a task plan. `dependsOn` holds indexes of earlier entries (ids do not exist yet). */
export const SubtaskPlanSchema = z.object({
  title: z.string().max(200).default(''),
  instructions: z.string().max(20_000).default(''),
  provider: AgentProviderIdSchema,
  role: AgentRoleSchema.default('developer'),
  model: z.string().nullable().default(null),
  repositoryId: IdSchema.nullable().default(null),
  dependsOn: z.array(z.number().int().min(0)).default([]),
});
export type SubtaskPlan = z.infer<typeof SubtaskPlanSchema>;

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
    }),
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
  'tasks.cancel': define(z.object({ taskId: IdSchema }), TaskSchema, 'session:write'),
  'tasks.pause': define(z.object({ taskId: IdSchema }), TaskSchema, 'session:write'),
  'tasks.resume': define(z.object({ taskId: IdSchema }), TaskSchema, 'session:write'),

  'worktrees.list': define(
    z.object({ workspaceId: IdSchema.optional(), taskId: IdSchema.optional() }),
    z.array(WorktreeSchema),
    'read',
  ),
  /** Removes a worktree directory (its branch is kept). Refused while dirty unless `force`, and while an agent works in it. */
  'worktrees.remove': define(
    z.object({ worktreeId: IdSchema, force: z.boolean().default(false) }),
    z.object({ removed: z.boolean() }),
    'workspace:admin',
  ),

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

  'home.summary': define(z.object({ workspaceId: IdSchema.optional() }), HomeSummarySchema, 'read'),
} as const;

export type CommandName = keyof typeof commands;
export type CommandParams<C extends CommandName> = z.input<(typeof commands)[C]['params']>;
export type CommandParsedParams<C extends CommandName> = z.output<(typeof commands)[C]['params']>;
export type CommandResult<C extends CommandName> = z.output<(typeof commands)[C]['result']>;

export const CommandNameSchema = z.enum(Object.keys(commands) as [CommandName, ...CommandName[]]);
