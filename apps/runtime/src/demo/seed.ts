import type { ApprovalRepo, SessionRepo, SettingsRepo, TaskRepo, WorkspaceRepo } from '@codeo/database';
import { buildDemoDataset } from './dataset';

export type DataMode = 'live' | 'demo';
const MODE_KEY = 'dataMode';
const SEEDED_KEY = 'demoSeeded';

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

/** Writes the demo dataset once. Returns true when it was written by this call. */
export async function seedDemoData(
  repos: { settings: SettingsRepo; workspaces: WorkspaceRepo; tasks: TaskRepo; sessions: SessionRepo; approvals: ApprovalRepo },
  machineId: string,
): Promise<boolean> {
  if (await repos.settings.get<boolean>(SEEDED_KEY, false)) return false;
  const data = buildDemoDataset(machineId);
  for (const ws of data.workspaces) await repos.workspaces.insert(ws);
  for (const s of data.sessions) await repos.sessions.upsert(s);
  for (const e of data.entries) await repos.sessions.appendEntry(e);
  for (const t of data.tasks) await repos.tasks.upsert(t);
  for (const a of data.approvals) await repos.approvals.upsert(a);
  await repos.settings.set(SEEDED_KEY, true);
  return true;
}
