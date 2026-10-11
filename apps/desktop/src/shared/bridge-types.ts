import type { CommandName, CommandParams, CommandResult, RuntimeEvent, RuntimeInfo } from '@codeo/contracts';

export type RuntimeConnectionState = 'starting' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface RuntimeStatus {
  state: RuntimeConnectionState;
  info: RuntimeInfo | null;
  error: string | null;
}

/** The entire surface the renderer gets. Nothing else from Node or Electron is reachable. */
export interface CodeoBridge {
  platform: 'darwin' | 'win32' | 'linux' | (string & {});
  appVersion: string;
  invoke<C extends CommandName>(command: C, params: CommandParams<C>): Promise<CommandResult<C>>;
  onEvent(listener: (payload: { seq: number; event: RuntimeEvent }) => void): () => void;
  onRuntimeStatus(listener: (status: RuntimeStatus) => void): () => void;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  pickDirectory(options?: { title?: string; defaultPath?: string }): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  getPreference<T>(key: string, fallback: T): Promise<T>;
  setPreference(key: string, value: unknown): Promise<void>;
  userName(): Promise<string>;
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
  userName: 'codeo:user-name',
} as const;
