import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { captureScreens } from './screenshots';
import WebSocket from 'ws';
import { CommandNameSchema, commands, RuntimeError } from '@codeo/contracts';
import { RuntimeClient } from '@codeo/remote-client';
import { createLogger } from '@codeo/shared-utils';
import { IPC, type RuntimeStatus } from '../shared/bridge-types';
import { RuntimeProcess } from './runtime-process';

const log = createLogger({ scope: 'desktop' });
const dataDir = process.env['CODEO_DATA_DIR'] ?? path.join(os.homedir(), '.codeo');
mkdirSync(dataDir, { recursive: true });
const prefsFile = path.join(dataDir, 'desktop-preferences.json');

let mainWindow: BrowserWindow | null = null;
let client: RuntimeClient | null = null;
const runtimeProcess = new RuntimeProcess(dataDir);
let status: RuntimeStatus = { state: 'starting', info: null, error: null };

function setStatus(next: Partial<RuntimeStatus>) {
  status = { ...status, ...next };
  mainWindow?.webContents.send(IPC.runtimeStatus, status);
}

function readPrefs(): Record<string, unknown> {
  try {
    return existsSync(prefsFile) ? (JSON.parse(readFileSync(prefsFile, 'utf8')) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function connectRuntime(): Promise<void> {
  try {
    const endpoint = await runtimeProcess.start();
    setStatus({ state: 'connecting', error: null });
    client = new RuntimeClient({
      url: endpoint.url,
      token: endpoint.token,
      client: { name: 'codeo-desktop', version: app.getVersion(), kind: 'desktop' },
      createWebSocket: (url) => new WebSocket(url) as never,
    });
    client.on('event', (payload) => mainWindow?.webContents.send(IPC.event, payload));
    client.on('state', (s) => {
      if (s === 'connected') setStatus({ state: 'connected', info: client?.runtime ?? null, error: null });
      else if (s === 'reconnecting') setStatus({ state: 'reconnecting' });
      else if (s === 'closed') setStatus({ state: 'closed' });
    });
    await client.connect();
    log.info('connected to runtime', { url: endpoint.url, external: endpoint.external });
  } catch (err) {
    log.error('runtime connection failed', { err: String(err) });
    setStatus({ state: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'Codeo',
    backgroundColor: '#0a0e0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost')) e.preventDefault();
  });
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
}

function registerIpc() {
  ipcMain.handle(IPC.invoke, async (_e, command: unknown, params: unknown) => {
    try {
      const name = CommandNameSchema.parse(command);
      if (!client) throw new RuntimeError('INTERNAL', 'Runtime non connecté', { key: 'disconnected' });
      /* Validate at the trust boundary even though the runtime validates again. */
      const parsed = commands[name].params.parse(params ?? {});
      return { ok: true, result: await client.request(name, parsed as never) };
    } catch (err) {
      if (err instanceof RuntimeError) return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
      return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } };
    }
  });
  ipcMain.handle(IPC.getRuntimeStatus, () => status);
  ipcMain.handle(IPC.pickDirectory, async (_e, options: { title?: string; defaultPath?: string }) => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: options.title ?? 'Choisir un dépôt Git',
      defaultPath: options.defaultPath ?? os.homedir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) await shell.openExternal(url);
  });
  ipcMain.handle(IPC.getPreference, (_e, key: string, fallback: unknown) => readPrefs()[key] ?? fallback);
  ipcMain.handle(IPC.setPreference, (_e, key: string, value: unknown) => {
    const prefs = { ...readPrefs(), [key]: value };
    writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
    if (key === 'theme' && (value === 'dark' || value === 'light' || value === 'system')) nativeTheme.themeSource = value;
  });
  ipcMain.handle(IPC.userName, () => {
    const info = os.userInfo();
    const full = (process.env['CODEO_USER_NAME'] ?? info.username).split(/[._-]/)[0] ?? info.username;
    return full.charAt(0).toUpperCase() + full.slice(1);
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Codeo', click: () => void shell.openExternal('https://github.com') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('Codeo');
app.whenReady().then(async () => {
  const prefs = readPrefs();
  const theme = prefs['theme'];
  nativeTheme.themeSource = theme === 'light' || theme === 'system' ? theme : 'dark';
  buildMenu();
  registerIpc();
  createWindow();
  void connectRuntime().then(() => {
    /* Design-validation harness: CODEO_SCREENSHOT_DIR=/path captures every screen then quits. */
    if (process.env['CODEO_SCREENSHOT_DIR'] && mainWindow) void captureScreens(mainWindow, process.env['CODEO_SCREENSHOT_DIR']).finally(() => app.quit());
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* Closing the window does not stop the runtime; quitting the app does (user-controlled lifecycle). */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  client?.close();
  void runtimeProcess.stop().finally(() => app.quit());
});
