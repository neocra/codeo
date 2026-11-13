import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createLogger } from '@codeo/shared-utils';

const log = createLogger({ scope: 'desktop:runtime' });

export interface RuntimeEndpoint {
  url: string;
  token: string;
  external: boolean;
}

function resolveRuntimeEntry(): string {
  const explicit = process.env['CODEO_RUNTIME_ENTRY'];
  if (explicit && existsSync(explicit)) return explicit;
  if (app.isPackaged) return path.join(process.resourcesPath, 'runtime', 'main.js');
  return path.resolve(import.meta.dirname, '../../../runtime/dist/main.js');
}

/**
 * Owns the runtime child process. The runtime is a plain Node program executed with
 * Electron's binary in Node mode, so packaged builds need no separate Node install.
 * Set CODEO_RUNTIME_URL + CODEO_RUNTIME_TOKEN to attach to an already-running runtime instead.
 */
export class RuntimeProcess {
  private child: ChildProcess | null = null;
  private stopping = false;

  constructor(
    private readonly dataDir: string,
    /** Demo mode: the runtime serves the fictional dataset with scripted agents. */
    private readonly demo = false,
  ) {}

  async start(): Promise<RuntimeEndpoint> {
    const url = process.env['CODEO_RUNTIME_URL'];
    const token = process.env['CODEO_RUNTIME_TOKEN'];
    if (url && token) return { url, token, external: true };

    /* A runtime started by hand leaves a discovery file; reuse it if the process is alive. */
    const discovery = path.join(this.dataDir, 'runtime.json');
    if (existsSync(discovery)) {
      try {
        const d = JSON.parse(readFileSync(discovery, 'utf8')) as { url: string; token: string; pid: number };
        process.kill(d.pid, 0);
        log.info('attaching to existing runtime', { pid: d.pid });
        return { url: d.url, token: d.token, external: true };
      } catch {
        /* stale file */
      }
    }

    const entry = resolveRuntimeEntry();
    if (!existsSync(entry)) throw new Error(`Runtime introuvable: ${entry}. Lancez "pnpm --filter @codeo/runtime build".`);
    const runtimeToken = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        CODEO_DATA_DIR: this.dataDir,
        CODEO_RUNTIME_TOKEN: runtimeToken,
        CODEO_RUNTIME_PARENT: 'desktop',
        CODEO_DEMO: this.demo ? '1' : '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
    child.on('exit', (code, signal) => {
      log.warn('runtime exited', { code, signal });
      this.child = null;
    });

    return new Promise<RuntimeEndpoint>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Le runtime n’a pas démarré à temps.')), 30_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const idx = buffer.indexOf('CODEO_RUNTIME_READY ');
        if (idx >= 0) {
          const line = buffer.slice(idx).split('\n')[0] ?? '';
          try {
            const ready = JSON.parse(line.replace('CODEO_RUNTIME_READY ', '')) as { url: string };
            clearTimeout(timer);
            resolve({ url: ready.url, token: runtimeToken, external: false });
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Le runtime s’est arrêté (code ${code}).`));
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    child.stdin?.end();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 4000))]);
    if (this.child) child.kill('SIGKILL');
  }
}
