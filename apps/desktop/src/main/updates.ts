import { app, shell, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { createLogger } from '@codeo/shared-utils';
import { IPC, type UpdateStatus } from '../shared/bridge-types';

const { autoUpdater } = electronUpdater;
const log = createLogger({ scope: 'desktop:updates' });
const RELEASES_URL = 'https://github.com/neocra/codeo/releases/latest';

/**
 * In-app updates through electron-updater against the GitHub releases of neocra/codeo
 * (the `latest*.yml` manifests are uploaded by .github/workflows/release.yml).
 * Nothing downloads without the user asking: the Settings screen drives check → install.
 */
export class UpdateService {
  private status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion(), availableVersion: null, releaseUrl: RELEASES_URL, progress: null, error: null };
  private window: BrowserWindow | null = null;

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: (m: unknown) => log.info(String(m)),
      warn: (m: unknown) => log.warn(String(m)),
      error: (m: unknown) => log.error(String(m)),
      debug: (m: unknown) => log.debug(String(m)),
    };
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', () => this.set({ state: 'ready', progress: 100 }));
    autoUpdater.on('error', (err) => this.fail(err));
  }

  attach(window: BrowserWindow): void {
    this.window = window;
    window.once('closed', () => {
      if (this.window === window) this.window = null;
    });
  }

  get current(): UpdateStatus {
    return this.status;
  }

  private set(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch };
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(IPC.updateStatus, this.status);
    return this.status;
  }

  private fail(err: unknown): UpdateStatus {
    const message = err instanceof Error ? err.message : String(err);
    log.error('update failed', { err: message });
    /* Unsigned macOS builds cannot self-update (Squirrel.Mac requires a valid signature): offer the manual download. */
    const needsManual = /code signature|not signed|ERR_UPDATER_INVALID_SIGNATURE|ZIP file not provided/i.test(message);
    return this.set({ state: needsManual ? 'manual' : 'error', error: message, progress: null });
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.set({ state: 'unsupported', error: 'Les mises à jour ne s’appliquent qu’à l’application installée.' });
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.status;
    this.set({ state: 'checking', error: null, progress: null });
    try {
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!result || !info || !result.isUpdateAvailable) return this.set({ state: 'up-to-date', availableVersion: null });
      return this.set({ state: 'available', availableVersion: info.version, releaseUrl: `https://github.com/neocra/codeo/releases/tag/v${info.version}` });
    } catch (err) {
      return this.fail(err);
    }
  }

  async install(): Promise<UpdateStatus> {
    if (this.status.state === 'ready') {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return this.status;
    }
    if (this.status.state !== 'available') return this.status;
    this.set({ state: 'downloading', progress: 0, error: null });
    try {
      await autoUpdater.downloadUpdate();
      /* 'update-downloaded' moved us to `ready`; restart into the new version. */
      const after = this.current;
      if (after.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return after;
    } catch (err) {
      return this.fail(err);
    }
  }

  async openReleasePage(): Promise<void> {
    await shell.openExternal(this.status.releaseUrl);
  }
}
