import type { AgentProviderId, AgentRole, ExecutionMode, AgentSession, ApprovalRequest, Repository, SessionEntry, SessionStatus, Subtask, Task, TaskStatus, Workspace } from '@codeo/domain';

/**
 * Fictional data for demo mode: two workspaces (Elyndor, a Unity game, and Codeo Cloud, a
 * SaaS monorepo) with tasks, transcripts and past approvals. Paths use the `demo://` scheme
 * so they can never be mistaken for — or resolved to — a real folder on the machine.
 */
export interface DemoDataset {
  workspaces: Workspace[];
  tasks: Task[];
  sessions: AgentSession[];
  entries: SessionEntry[];
  approvals: ApprovalRequest[];
}

export const DEMO_PATH_PREFIX = 'demo://';
/** Draft task the demo runtime starts on first boot so a live session and a pending approval are visible. */
export const DEMO_LIVE_TASK_ID = 'task_demo_ely163';

type EntryDraft = SessionEntry extends infer E ? (E extends SessionEntry ? Omit<E, 'id' | 'sessionId' | 'seq' | 'at'> : never) : never;

interface SessionSpec {
  id: string;
  workspaceId: string;
  repositoryId: string;
  cwd: string;
  taskId: string | null;
  provider: AgentProviderId;
  role: AgentRole;
  title: string;
  status: SessionStatus;
  executionMode: ExecutionMode;
  model: string;
  error?: string;
  /** Minutes before `now` the session started; entries are spaced one minute apart. */
  startedMinAgo: number;
  entries: EntryDraft[];
}

interface TaskSpec {
  id: string;
  workspaceId: string;
  key: string;
  title: string;
  objective: string;
  status: TaskStatus;
  repositoryId: string;
  provider: AgentProviderId;
  role: AgentRole;
  executionMode: ExecutionMode;
  sessionId: string | null;
  progress: number;
  error?: string;
  createdMinAgo: number;
}

export function buildDemoDataset(machineId: string, now = new Date()): DemoDataset {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  const repo = (id: string, workspaceId: string, name: string, path: string, services: [string, string][] = []): Repository => ({
    id,
    workspaceId,
    name,
    path: `${DEMO_PATH_PREFIX}${path}`,
    defaultBranch: 'main',
    remoteUrl: `https://example.com/demo/${name}.git`,
    services: services.map(([sid, sp]) => ({ id: `svc_${id}_${sid}`, repositoryId: id, name: sid, path: sp, dependsOn: [] })),
    createdAt: ago(60 * 24 * 30),
  });

  const ely = 'ws_demo_elyndor';
  const cloud = 'ws_demo_codeo_cloud';
  const elyUnity = repo('repo_demo_ely_unity', ely, 'elyndor-unity', 'elyndor/elyndor-unity');
  const elyBackend = repo('repo_demo_ely_backend', ely, 'elyndor-backend', 'elyndor/elyndor-backend');
  const cloudRepo = repo('repo_demo_cloud', cloud, 'codeo-cloud', 'codeo-cloud', [
    ['web', 'apps/web'],
    ['api', 'apps/api'],
    ['billing', 'packages/billing'],
  ]);

  const workspaces: Workspace[] = [
    {
      id: ely,
      machineId,
      name: 'Elyndor',
      description: 'RPG coopératif sous Unity : client de jeu et services de matchmaking.',
      type: 'multi-repo',
      repositories: [elyUnity, elyBackend],
      defaultProvider: 'claude-code',
      defaultExecutionMode: 'manual',
      createdAt: ago(60 * 24 * 30),
      updatedAt: ago(60),
    },
    {
      id: cloud,
      machineId,
      name: 'Codeo Cloud',
      description: 'SaaS de facturation : application web, API publique et module de paiement.',
      type: 'monorepo',
      repositories: [cloudRepo],
      defaultProvider: 'codex',
      defaultExecutionMode: 'auto',
      createdAt: ago(60 * 24 * 20),
      updatedAt: ago(120),
    },
  ];

  const sessionSpecs: SessionSpec[] = [
    {
      id: 'ses_demo_ely142',
      workspaceId: ely,
      repositoryId: elyUnity.id,
      cwd: elyUnity.path,
      taskId: 'task_demo_ely142',
      provider: 'claude-code',
      role: 'developer',
      title: 'ELY-142 · Empilement des objets dans l’inventaire',
      status: 'idle',
      executionMode: 'manual',
      model: 'demo-claude',
      startedMinAgo: 95,
      entries: [
        { kind: 'user_message', text: 'Ticket: ELY-142\nTâche: Empilement des objets dans l’inventaire\n\nLes potions et les matériaux doivent s’empiler jusqu’à 99 par case.' },
        { kind: 'assistant_text', text: 'Je commence par lire la grille d’inventaire et la définition des objets.', streaming: false },
        { kind: 'tool_call', toolUseId: 'tu_demo_1', tool: 'Read', input: { file_path: 'Assets/Scripts/Inventory/InventoryGrid.cs' }, status: 'completed', output: '(contenu fictif — mode démo)' },
        { kind: 'tool_call', toolUseId: 'tu_demo_2', tool: 'Edit', input: { file_path: 'Assets/Scripts/Inventory/InventoryGrid.cs' }, status: 'completed', output: '(modification simulée — aucun fichier écrit)' },
        { kind: 'tool_call', toolUseId: 'tu_demo_3', tool: 'Bash', input: { command: 'unity -runTests -testPlatform EditMode' }, status: 'completed', output: '38 tests passés, 0 échec' },
        { kind: 'assistant_text', text: 'L’empilement est en place : `ItemDefinition.maxStack` (99 par défaut), fusion automatique au ramassage et séparation avec Maj+clic. Deux tests ajoutés.', streaming: false },
        { kind: 'result', ok: true, summary: 'Empilement jusqu’à 99, fusion au ramassage, 2 tests ajoutés. À relire.', durationMs: 412_000, costUsd: 0.84, turns: 9 },
      ],
    },
    {
      id: 'ses_demo_ely151',
      workspaceId: ely,
      repositoryId: elyBackend.id,
      cwd: elyBackend.path,
      taskId: 'task_demo_ely151',
      provider: 'codex',
      role: 'backend',
      title: 'ELY-151 · Désynchronisation du Gardien en coop',
      status: 'failed',
      executionMode: 'auto',
      model: 'demo-codex',
      error: 'Les tests d’intégration du lobby échouent (timeout réseau simulé).',
      startedMinAgo: 240,
      entries: [
        { kind: 'user_message', text: 'Ticket: ELY-151\nTâche: Désynchronisation du Gardien en coop\n\nLe boss change de phase à des moments différents selon les joueurs.' },
        { kind: 'assistant_text', text: 'Le serveur diffuse la phase du boss sans numéro de tick : je vais l’ajouter au message `BossPhaseChanged`.', streaming: false },
        { kind: 'tool_call', toolUseId: 'tu_demo_4', tool: 'Edit', input: { file_path: 'src/matchmaking/lobby.go' }, status: 'completed', output: '(modification simulée — aucun fichier écrit)' },
        { kind: 'tool_call', toolUseId: 'tu_demo_5', tool: 'Bash', input: { command: 'go test ./...' }, status: 'failed', output: 'FAIL src/matchmaking  TestLobbyReconnect (timeout 30s)' },
        { kind: 'system', level: 'error', text: 'Les tests d’intégration du lobby échouent (timeout réseau simulé).', key: null, params: null },
      ],
    },
    {
      id: 'ses_demo_cc88',
      workspaceId: cloud,
      repositoryId: cloudRepo.id,
      cwd: cloudRepo.path,
      taskId: 'task_demo_cc88',
      provider: 'codex',
      role: 'developer',
      title: 'CC-88 · Export CSV des factures',
      status: 'completed',
      executionMode: 'auto',
      model: 'demo-codex',
      startedMinAgo: 60 * 26,
      entries: [
        { kind: 'user_message', text: 'Ticket: CC-88\nTâche: Export CSV des factures\n\nAjouter un export CSV filtrable par période dans la page Factures.' },
        { kind: 'tool_call', toolUseId: 'tu_demo_6', tool: 'Edit', input: { file_path: 'apps/api/src/routes/invoices.ts' }, status: 'completed', output: '(modification simulée — aucun fichier écrit)' },
        { kind: 'tool_call', toolUseId: 'tu_demo_7', tool: 'Edit', input: { file_path: 'apps/web/src/pages/Invoices.tsx' }, status: 'completed', output: '(modification simulée — aucun fichier écrit)' },
        { kind: 'assistant_text', text: 'Route `GET /invoices/export.csv?from&to` en streaming et bouton « Exporter » dans la page Factures.', streaming: false },
        { kind: 'result', ok: true, summary: 'Export CSV livré, relu et fusionné.', durationMs: 655_000, costUsd: 1.12, turns: 14 },
      ],
    },
    {
      id: 'ses_demo_cc91',
      workspaceId: cloud,
      repositoryId: cloudRepo.id,
      cwd: cloudRepo.path,
      taskId: 'task_demo_cc91',
      provider: 'claude-code',
      role: 'backend',
      title: 'CC-91 · Limitation de débit de l’API publique',
      status: 'idle',
      executionMode: 'manual',
      model: 'demo-claude',
      startedMinAgo: 45,
      entries: [
        { kind: 'user_message', text: 'Ticket: CC-91\nTâche: Limitation de débit de l’API publique\n\n100 requêtes par minute et par clé, en-têtes RateLimit standard.' },
        { kind: 'tool_call', toolUseId: 'tu_demo_8', tool: 'Edit', input: { file_path: 'apps/api/src/middleware/rate-limit.ts' }, status: 'completed', output: '(modification simulée — aucun fichier écrit)' },
        { kind: 'tool_call', toolUseId: 'tu_demo_9', tool: 'Bash', input: { command: 'rm -rf apps/api/.cache' }, status: 'denied', output: 'Refusé par l’utilisateur.' },
        { kind: 'assistant_text', text: 'Le middleware est prêt (fenêtre glissante en mémoire, en-têtes `RateLimit-*`). Je n’ai pas vidé le cache comme vous l’avez demandé.', streaming: false },
        { kind: 'result', ok: true, summary: 'Middleware de limitation ajouté avec tests. Suppression du cache refusée.', durationMs: 298_000, costUsd: 0.51, turns: 7 },
      ],
    },
  ];

  const sessions: AgentSession[] = [];
  const entries: SessionEntry[] = [];
  for (const spec of sessionSpecs) {
    const last = ago(spec.startedMinAgo - spec.entries.length);
    sessions.push({
      id: spec.id,
      workspaceId: spec.workspaceId,
      taskId: spec.taskId,
      subtaskId: null,
      repositoryId: spec.repositoryId,
      worktreeId: null,
      provider: spec.provider,
      role: spec.role,
      title: spec.title,
      status: spec.status,
      providerSessionId: `demo_${spec.id}`,
      cwd: spec.cwd,
      model: spec.model,
      executionMode: spec.executionMode,
      error: spec.error ?? null,
      createdAt: ago(spec.startedMinAgo),
      updatedAt: last,
      lastActivityAt: last,
    });
    spec.entries.forEach((e, i) => entries.push({ ...e, id: `ent_${spec.id}_${i + 1}`, sessionId: spec.id, seq: i + 1, at: ago(spec.startedMinAgo - i) } as SessionEntry));
  }

  const taskSpecs: TaskSpec[] = [
    { id: 'task_demo_ely142', workspaceId: ely, key: 'ELY-142', title: 'Empilement des objets dans l’inventaire', objective: 'Les potions et les matériaux doivent s’empiler jusqu’à 99 par case.', status: 'review', repositoryId: elyUnity.id, provider: 'claude-code', role: 'developer', executionMode: 'manual', sessionId: 'ses_demo_ely142', progress: 90, createdMinAgo: 100 },
    { id: 'task_demo_ely151', workspaceId: ely, key: 'ELY-151', title: 'Désynchronisation du Gardien en coop', objective: 'Le boss change de phase à des moments différents selon les joueurs.', status: 'failed', repositoryId: elyBackend.id, provider: 'codex', role: 'backend', executionMode: 'auto', sessionId: 'ses_demo_ely151', progress: 40, createdMinAgo: 250, error: 'Les tests d’intégration du lobby échouent (timeout réseau simulé).' },
    { id: DEMO_LIVE_TASK_ID, workspaceId: ely, key: 'ELY-163', title: 'Accélérer le chargement des scènes', objective: 'Charger les scènes de donjon en asynchrone avec un écran de transition.', status: 'draft', repositoryId: elyUnity.id, provider: 'claude-code', role: 'developer', executionMode: 'manual', sessionId: null, progress: 0, createdMinAgo: 20 },
    { id: 'task_demo_ely170', workspaceId: ely, key: 'ELY-170', title: 'Localisation allemande', objective: 'Ajouter la langue allemande aux menus et aux dialogues.', status: 'draft', repositoryId: elyUnity.id, provider: 'codex', role: 'frontend', executionMode: 'auto', sessionId: null, progress: 0, createdMinAgo: 10 },
    { id: 'task_demo_cc88', workspaceId: cloud, key: 'CC-88', title: 'Export CSV des factures', objective: 'Ajouter un export CSV filtrable par période dans la page Factures.', status: 'completed', repositoryId: cloudRepo.id, provider: 'codex', role: 'developer', executionMode: 'auto', sessionId: 'ses_demo_cc88', progress: 100, createdMinAgo: 60 * 27 },
    { id: 'task_demo_cc91', workspaceId: cloud, key: 'CC-91', title: 'Limitation de débit de l’API publique', objective: '100 requêtes par minute et par clé, en-têtes RateLimit standard.', status: 'review', repositoryId: cloudRepo.id, provider: 'claude-code', role: 'backend', executionMode: 'manual', sessionId: 'ses_demo_cc91', progress: 90, createdMinAgo: 50 },
    { id: 'task_demo_cc97', workspaceId: cloud, key: 'CC-97', title: 'Sessions courtes pour l’authentification', objective: 'Remplacer les jetons longue durée par des sessions de 15 min avec rafraîchissement.', status: 'draft', repositoryId: cloudRepo.id, provider: 'codex', role: 'backend', executionMode: 'auto', sessionId: null, progress: 0, createdMinAgo: 5 },
  ];

  const subtaskStatus = (s: TaskStatus): Subtask['status'] =>
    s === 'review' || s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : 'pending';
  const tasks: Task[] = taskSpecs.map((t) => {
    const started = t.sessionId ? ago(t.createdMinAgo - 5) : null;
    return {
      id: t.id,
      workspaceId: t.workspaceId,
      ticketId: null,
      ticketKey: t.key,
      title: t.title,
      objective: t.objective,
      status: t.status,
      orchestration: 'single',
      /* Demo repositories are not Git checkouts: no worktrees. */
      isolation: 'none',
      executionMode: t.executionMode,
      repositoryIds: [t.repositoryId],
      subtasks: [
        {
          id: `sub_${t.id}`,
          taskId: t.id,
          title: t.title,
          instructions: t.objective,
          assignment: { role: t.role, provider: t.provider, model: null, executionMode: t.executionMode },
          repositoryId: t.repositoryId,
          dependsOn: [],
          status: subtaskStatus(t.status),
          sessionId: t.sessionId,
          worktreeId: null,
          order: 0,
          error: t.error ?? null,
          attemptStartedAt: started,
        },
      ],
      progress: t.progress,
      createdAt: ago(t.createdMinAgo),
      updatedAt: ago(Math.max(0, t.createdMinAgo - 10)),
      startedAt: started,
      completedAt: t.status === 'completed' ? ago(t.createdMinAgo - 30) : null,
    };
  });

  const approval = (id: string, sessionId: string, taskId: string, workspaceId: string, provider: AgentProviderId, tool: string, input: Record<string, unknown>, summary: string, risk: ApprovalRequest['risk'], status: 'approved' | 'rejected', minAgo: number): ApprovalRequest => ({
    id,
    sessionId,
    taskId,
    workspaceId,
    provider,
    providerRequestId: `${id}_req`,
    tool,
    input,
    summary,
    affected: [String(input['file_path'] ?? input['command'] ?? '')].filter(Boolean),
    risk,
    reason: null,
    status,
    createdAt: ago(minAgo),
    expiresAt: ago(minAgo - 15),
    resolvedAt: ago(minAgo - 1),
    decidedBy: 'desktop',
  });
  const approvals: ApprovalRequest[] = [
    approval('apr_demo_1', 'ses_demo_ely142', 'task_demo_ely142', ely, 'claude-code', 'Edit', { file_path: 'Assets/Scripts/Inventory/InventoryGrid.cs' }, 'Modifier Assets/Scripts/Inventory/InventoryGrid.cs', 'medium', 'approved', 92),
    approval('apr_demo_2', 'ses_demo_cc91', 'task_demo_cc91', cloud, 'claude-code', 'Bash', { command: 'rm -rf apps/api/.cache' }, 'Exécuter `rm -rf apps/api/.cache`', 'high', 'rejected', 43),
  ];

  return { workspaces, tasks, sessions, entries, approvals };
}
