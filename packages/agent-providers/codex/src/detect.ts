import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ProviderStatus } from '@codeo/domain';

const require = createRequire(import.meta.url);

const TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

/** The Codex CLI the SDK ships (`@openai/codex` platform package), else an explicit path. */
export function resolveCodexExecutable(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  const triple = TARGETS[`${process.platform}-${process.arch}`];
  if (!triple) return null;
  const bin = process.platform === 'win32' ? 'codex.exe' : 'codex';
  try {
    /* Mirror the SDK's own lookup: codex-sdk → @openai/codex → its optional platform package. */
    /* codex-sdk only exposes ESM `exports`, so resolve it the ESM way and fall back to CJS. */
    let sdkEntry: string;
    try {
      sdkEntry = fileURLToPath(import.meta.resolve('@openai/codex-sdk'));
    } catch {
      sdkEntry = require.resolve('@openai/codex-sdk');
    }
    const codexPkgJson = createRequire(sdkEntry).resolve('@openai/codex/package.json');
    const platformPkgJson = createRequire(codexPkgJson).resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    const p = path.join(path.dirname(platformPkgJson), 'vendor', triple, 'bin', bin);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function run(file: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      const raw = err ? (err as NodeJS.ErrnoException & { code?: number | string }).code : 0;
      resolve({ code: typeof raw === 'number' ? raw : err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function detectCodex(explicitPath?: string): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    provider: 'codex',
    displayName: 'Codex',
    installed: false,
    version: null,
    executable: null,
    authenticated: 'unknown',
    authDetail: null,
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: true,
      /* `codex exec` (what the SDK drives) is non-interactive: no per-tool approval callback. Codex's own sandbox applies. */
      permissionRequests: false,
      modelSelection: true,
      toolCalls: true,
      structuredOutput: true,
      worktreeAware: true,
    },
    models: [
      { id: 'default', displayName: 'Par défaut', description: 'Modèle par défaut de Codex' },
      { id: 'gpt-5-codex', displayName: 'GPT-5 Codex', description: 'Optimisé pour le code' },
      { id: 'gpt-5', displayName: 'GPT-5', description: 'Généraliste' },
    ],
    modes: ['read-only', 'workspace-write', 'danger-full-access'],
    error: null,
    checkedAt: new Date().toISOString(),
  };
  const exe = resolveCodexExecutable(explicitPath);
  if (!exe) return { ...base, error: 'Exécutable Codex introuvable (paquet @openai/codex absent).' };
  const version = await run(exe, ['--version']);
  if (version.code !== 0) return { ...base, executable: exe, error: `Impossible de lancer Codex: ${version.stderr.trim() || version.code}` };
  const v = version.stdout.trim().replace(/^codex-cli\s+/, '') || null;
  const login = await run(exe, ['login', 'status']);
  const text = `${login.stdout}${login.stderr}`.trim();
  const authenticated: ProviderStatus['authenticated'] = login.code === 0 ? 'yes' : /not logged in/i.test(text) ? 'no' : 'unknown';
  return {
    ...base,
    installed: true,
    version: v,
    executable: exe,
    authenticated,
    authDetail: text || (authenticated === 'no' ? 'Lancez `codex login` ou définissez OPENAI_API_KEY.' : null),
  };
}
