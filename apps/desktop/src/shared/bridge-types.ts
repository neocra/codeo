import type { CommandName, CommandParams, CommandResult, ErrorCode, RuntimeEvent, RuntimeInfo } from '@codeo/contracts';

/** IPC cannot carry Error subclasses, so command failures travel as data and are rethrown in the renderer. */
export type InvokeOutcome<T> = { ok: true; result: T } | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export type RuntimeConnectionState = 'starting' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface RuntimeStatus {
  state: RuntimeConnectionState;
  info: RuntimeInfo | null;
  error: string | null;
}

export type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'manual' | 'error' | 'unsupported';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion: string | null;
  releaseUrl: string;
  /** Download progress in percent while `downloading`. */
  progress: number | null;
  error: string | null;
}

/** The entire surface the renderer gets. Nothing else from Node or Electron is reachable. */
export interface CodeoBridge {
  platform: 'darwin' | 'win32' | 'linux' | (string & {});
  appVersion: string;
  invoke<C extends CommandName>(command: C, params: CommandParams<C>): Promise<InvokeOutcome<CommandResult<C>>>;
  onEvent(listener: (payload: { seq: number; event: RuntimeEvent }) => void): () => void;
  onRuntimeStatus(listener: (status: RuntimeStatus) => void): () => void;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  pickDirectory(options?: { title?: string; defaultPath?: string }): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  getPreference<T>(key: string, fallback: T): Promise<T>;
  setPreference(key: string, value: unknown): Promise<void>;
  /** Restarts the runtime in demo mode (separate data directory) or back in live mode. */
  setDemoMode(enabled: boolean): Promise<void>;
  userName(): Promise<string>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  openReleasePage(): Promise<void>;
}

export const IPC = {
  invoke: 'codeo:invoke',
  event: 'codeo:event',
  runtimeStatus: 'codeo:runtime-status',
  getRuntimeStatus: 'codeo:get-runtime-status',
  pickDirectory: 'codeo:pick-directory',
  openExternal: 'codeo:open-external',
  getPreference: 'codeo:get-preference',
  setPreference: 'codeo:set-preference',
  setDemoMode: 'codeo:set-demo-mode',
  userName: 'codeo:user-name',
  updateCheck: 'codeo:update-check',
  updateInstall: 'codeo:update-install',
  updateStatus: 'codeo:update-status',
  getUpdateStatus: 'codeo:get-update-status',
  openReleasePage: 'codeo:open-release-page',
} as const;
