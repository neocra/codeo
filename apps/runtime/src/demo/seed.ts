import type { ApprovalRepo, PullRequestRepo, SessionRepo, SettingsRepo, TaskRepo, WorkspaceRepo, WorktreeRepo } from '@codeo/database';
import { buildDemoDataset } from './dataset';

export type DataMode = 'live' | 'demo';
const MODE_KEY = 'dataMode';
const SEEDED_KEY = 'demoSeeded';
/**
 * Version of the dataset written in a demo database. 1 (stored as `true`): workspaces, tasks, sessions, approvals.
 * 2: reviewed worktrees with scripted diffs and pull requests.
 */
export const DEMO_DATASET_VERSION = 2;

/**
 * A database belongs to exactly one mode, recorded on first boot. A live runtime never opens
 * demo data and a demo runtime never opens (or seeds into) a database that holds real work.
 */
export async function assertDataMode(settings: SettingsRepo, workspaces: WorkspaceRepo, mode: DataMode): Promise<void> {
  const stored = await settings.get<DataMode | null>(MODE_KEY, null);
  if (stored && stored !== mode) {
    throw new Error(
      mode === 'demo'
        ? 'Ce dossier de données contient des données réelles : le mode démo utilise un dossier séparé.'
        : 'Ce dossier de données contient le jeu de démonstration : le mode réel utilise un dossier séparé.',
    );
  }
  if (!stored) {
    if (mode === 'demo' && (await workspaces.list()).length > 0) {
      throw new Error('Ce dossier de données contient déjà des espaces de travail : le mode démo exige un dossier vide.');
    }
    await settings.set(MODE_KEY, mode);
  }
}

export interface DemoRepos {
  settings: SettingsRepo;
  workspaces: WorkspaceRepo;
  tasks: TaskRepo;
  sessions: SessionRepo;
  approvals: ApprovalRepo;
  worktrees: WorktreeRepo;
  pullRequests: PullRequestRepo;
}

/**
 * Writes the demo dataset. Returns true when it was written from scratch by this call. A database seeded by an
 * older version gets what that version lacked — the review lanes, their tasks and sessions (moved into the lane)
 * and the pull requests — without touching the rest of what was done in the demo since.
 */
export async function seedDemoData(repos: DemoRepos, machineId: string): Promise<boolean> {
  const stored = await repos.settings.get<boolean | number>(SEEDED_KEY, false);
  const version = stored === true ? 1 : stored === false ? 0 : stored;
  if (version >= DEMO_DATASET_VERSION) return false;
  const data = buildDemoDataset(machineId);
  if (version === 0) {
    for (const ws of data.workspaces) await repos.workspaces.insert(ws);
    for (const s of data.sessions) await repos.sessions.upsert(s);
    for (const e of data.entries) await repos.sessions.appendEntry(e);
    for (const t of data.tasks) await repos.tasks.upsert(t);
    for (const a of data.approvals) await repos.approvals.upsert(a);
  } else {
    const laneTasks = new Set(data.worktrees.map((w) => w.taskId));
    for (const s of data.sessions) {
      const existing = await repos.sessions.get(s.id);
      if (!existing) {
        await repos.sessions.upsert(s);
        for (const e of data.entries.filter((x) => x.sessionId === s.id)) await repos.sessions.appendEntry(e);
      } else if (laneTasks.has(s.taskId)) {
        await repos.sessions.upsert({ ...existing, cwd: s.cwd, worktreeId: s.worktreeId, subtaskId: s.subtaskId });
      }
    }
    for (const t of data.tasks) if (laneTasks.has(t.id) || !(await repos.tasks.get(t.id))) await repos.tasks.upsert(t);
  }
  for (const w of data.worktrees) if (!(await repos.worktrees.get(w.id))) await repos.worktrees.insert(w);
  for (const pr of data.pullRequests) await repos.pullRequests.upsert(pr);
  await repos.settings.set(SEEDED_KEY, DEMO_DATASET_VERSION);
  return version === 0;
}
