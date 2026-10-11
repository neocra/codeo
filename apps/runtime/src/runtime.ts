import os from 'node:os';
import path from 'node:path';
import { ClaudeCodeProvider } from '@codeo/agent-provider-claude-code';
import { CodexProvider } from '@codeo/agent-provider-codex';
import type { AgentProvider } from '@codeo/agent-provider-core';
import { commands, RuntimeError, type CommandName, type CommandParsedParams, type CommandResult, type CommandScope, type RuntimeInfo } from '@codeo/contracts';
import { ApprovalRepo, EventRepo, openDatabase, SessionRepo, SettingsRepo, TaskRepo, WorkspaceRepo, type OpenedDatabase } from '@codeo/database';
import type { Machine } from '@codeo/domain';
import { inspectRepository } from '@codeo/git';
import { createLogger, newId, type Logger } from '@codeo/shared-utils';
import { EventBus } from './event-bus';
import { ApprovalService } from './services/approvals';
import { ProviderRegistry } from './services/providers';
import { SessionService } from './services/sessions';
import { TaskService } from './services/tasks';
import { WorkspaceService } from './services/workspaces';
import { RUNTIME_VERSION } from './version';

export interface RuntimeOptions {
  dataDir: string;
  logger?: Logger;
  providers?: AgentProvider[];
  /** Skip provider detection at boot (tests). */
  detectProviders?: boolean;
  migrationsFolder?: string;
}

export interface CallContext {
  scopes: CommandScope[];
  clientKind: 'desktop' | 'mobile' | 'gateway' | 'cli' | 'test';
}

type Handler<C extends CommandName> = (params: CommandParsedParams<C>, ctx: CallContext) => Promise<CommandResult<C>>;
type Handlers = { [C in CommandName]: Handler<C> };

export interface Runtime {
  info: RuntimeInfo;
  bus: EventBus;
  services: {
    providers: ProviderRegistry;
    workspaces: WorkspaceService;
    sessions: SessionService;
    tasks: TaskService;
    approvals: ApprovalService;
  };
  /** Validates params, checks authorization, executes; returns a validated result. */
  call<C extends CommandName>(command: C, rawParams: unknown, ctx: CallContext): Promise<CommandResult<C>>;
  shutdown(): Promise<void>;
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const log = opts.logger ?? createLogger({ scope: 'runtime' });
  const db: OpenedDatabase = await openDatabase({
    file: opts.dataDir === ':memory:' ? ':memory:' : path.join(opts.dataDir, 'codeo.db'),
    ...(opts.migrationsFolder ? { migrationsFolder: opts.migrationsFolder } : {}),
  });
  const settings = new SettingsRepo(db.db);
  const machineId = await settings.get<string | null>('machineId', null) ?? newId('mac');
  await settings.set('machineId', machineId);
  const machine: Machine = {
    id: machineId,
    name: os.hostname(),
    platform: process.platform as Machine['platform'],
    runtimeVersion: RUNTIME_VERSION,
    connection: 'local',
    status: 'connected',
  };

  const bus = new EventBus(new EventRepo(db.db), log.child('events'));
  await bus.init();
  const providers = new ProviderRegistry(opts.providers ?? [new ClaudeCodeProvider(), new CodexProvider()], bus, log.child('providers'));
  const workspaces = new WorkspaceService(new WorkspaceRepo(db.db), bus, machineId);
  const approvals = new ApprovalService(new ApprovalRepo(db.db), bus, log.child('approvals'));
  const sessions = new SessionService(new SessionRepo(db.db), workspaces, providers, approvals, bus, log.child('sessions'));
  const tasks = new TaskService(new TaskRepo(db.db), workspaces, sessions, bus, log.child('tasks'));
  await approvals.init();
  await sessions.init();
  await tasks.init();

  const info: RuntimeInfo = {
    version: RUNTIME_VERSION,
    protocolVersion: 1,
    machine,
    dataDir: opts.dataDir,
    startedAt: new Date().toISOString(),
    demoMode: false,
  };

  if (opts.detectProviders !== false) {
    void providers.detectAll().then((list) => log.info('providers detected', { providers: list.map((p) => `${p.provider}:${p.installed ? p.version : 'absent'}:${p.authenticated}`) }));
  }

  const handlers: Handlers = {
    'runtime.info': async () => info,
    'providers.list': async ({ refresh }) => (refresh || providers.list().length === 0 ? providers.detectAll() : providers.list()),
    'repositories.inspect': async ({ path: p }) => inspectRepository(p),
    'workspaces.list': async () => workspaces.list(),
    'workspaces.create': async (p) => workspaces.create(p),
    'workspaces.addRepository': async (p) => workspaces.addRepository(p.workspaceId, p.path),
    'workspaces.removeRepository': async (p) => workspaces.removeRepository(p.workspaceId, p.repositoryId),
    'workspaces.delete': async (p) => ({ deleted: await workspaces.delete(p.workspaceId) }),
    'tasks.list': async (p) => tasks.list(p.workspaceId),
    'tasks.get': async (p) => tasks.get(p.taskId),
    'tasks.create': async (p) => tasks.create(p),
    'tasks.start': async (p) => tasks.start(p.taskId),
    'tasks.cancel': async (p) => tasks.cancel(p.taskId),
    'tasks.pause': async (p) => tasks.pause(p.taskId),
    'tasks.resume': async (p) => tasks.resume(p.taskId),
    'sessions.list': async (p) => sessions.list(p),
    'sessions.get': async (p) => ({ session: await sessions.get(p.sessionId), entries: await sessions.entries(p.sessionId, p.afterSeq) }),
    'sessions.start': async (p) => sessions.start(p),
    'sessions.send': async (p) => sessions.send(p.sessionId, p.text),
    'sessions.cancel': async (p) => sessions.cancel(p.sessionId),
    'approvals.list': async (p) => approvals.list(p),
    'approvals.resolve': async (p, ctx) => approvals.resolve(p.approvalId, p.decision, ctx.clientKind === 'mobile' ? 'mobile' : 'desktop', p.reason),
    'home.summary': async (p) => {
      const all = await workspaces.list();
      const workspace = (p.workspaceId ? all.find((w) => w.id === p.workspaceId) : all[0]) ?? null;
      const wsId = workspace?.id;
      const sessionsList = await sessions.list(wsId ? { workspaceId: wsId } : {});
      const taskList = await tasks.list(wsId);
      return {
        workspace,
        activeSessions: sessionsList.filter((s) => s.status === 'running' || s.status === 'waiting_approval'),
        recentSessions: sessionsList.slice(0, 8),
        pendingApprovals: await approvals.list({ status: 'pending', ...(wsId ? { workspaceId: wsId } : {}) }),
        activeTasks: taskList.filter((t) => !['completed', 'cancelled', 'draft'].includes(t.status)),
        recentFailures: sessionsList.filter((s) => s.status === 'failed').slice(0, 3),
      };
    },
  };

  async function call<C extends CommandName>(command: C, rawParams: unknown, ctx: CallContext): Promise<CommandResult<C>> {
    const def = commands[command];
    if (!def) throw new RuntimeError('NOT_FOUND', `Commande inconnue: ${command}`);
    if (!ctx.scopes.includes(def.scope)) throw new RuntimeError('FORBIDDEN', `Portée requise: ${def.scope}`);
    const parsed = def.params.safeParse(rawParams ?? {});
    if (!parsed.success) throw new RuntimeError('INVALID_PARAMS', 'Paramètres invalides', parsed.error.issues);
    const handler = handlers[command] as Handler<C>;
    const result = await handler(parsed.data as CommandParsedParams<C>, ctx);
    const validated = def.result.safeParse(result);
    if (!validated.success) {
      log.error('result validation failed', { command, issues: validated.error.issues.slice(0, 3) });
      throw new RuntimeError('INTERNAL', 'Résultat invalide');
    }
    return validated.data as CommandResult<C>;
  }

  return {
    info,
    bus,
    services: { providers, workspaces, sessions, tasks, approvals },
    call,
    async shutdown() {
      approvals.shutdown();
      await sessions.shutdown();
      await bus.flush();
      db.close();
    },
  };
}
