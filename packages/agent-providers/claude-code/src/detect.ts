import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProviderStatus } from '@codeo/domain';

const require = createRequire(import.meta.url);

/**
 * Resolves the native CLI bundled with the Agent SDK's platform package, or a user-provided path.
 * The platform package is an optional dependency of the SDK, so it is resolved from the SDK's own
 * location (works with hoisted and isolated node_modules layouts alike).
 */
export function resolveClaudeExecutable(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude';
  try {
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const fromSdk = createRequire(sdkEntry);
    const pkgJson = fromSdk.resolve(`${pkg}/package.json`);
    const p = path.join(path.dirname(pkgJson), bin);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function run(file: string, args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'codeo/0.1.0' } }, (err, stdout, stderr) => {
      const raw = err ? (err as NodeJS.ErrnoException & { code?: number | string }).code : 0;
      resolve({ code: typeof raw === 'number' ? raw : err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

interface AuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  subscriptionType?: string;
}

/**
 * Real detection: locate the executable, read its version, and ask the CLI's own
 * `auth status` (documented command, JSON output) whether it is logged in.
 */
export async function detectClaudeCode(explicitPath?: string): Promise<ProviderStatus> {
  const checkedAt = new Date().toISOString();
  const base: ProviderStatus = {
    provider: 'claude-code',
    displayName: 'Claude Code',
    installed: false,
    version: null,
    executable: null,
    authenticated: 'unknown',
    authDetail: null,
    capabilities: {
      streaming: true,
      resume: true,
      interrupt: true,
      permissionRequests: true,
      modelSelection: true,
      toolCalls: true,
      structuredOutput: true,
      worktreeAware: true,
    },
    models: [
      { id: 'default', displayName: 'Par défaut', description: 'Modèle par défaut de Claude Code' },
      { id: 'sonnet', displayName: 'Sonnet', description: 'Rapide et économique' },
      { id: 'opus', displayName: 'Opus', description: 'Le plus capable' },
      { id: 'haiku', displayName: 'Haiku', description: 'Le plus léger' },
    ],
    modes: ['default', 'acceptEdits', 'auto', 'plan'],
    error: null,
    checkedAt,
  };
  const exe = resolveClaudeExecutable(explicitPath);
  if (!exe) return { ...base, error: 'Exécutable Claude Code introuvable (paquet natif du SDK absent).' };

  const version = await run(exe, ['--version']);
  if (version.code !== 0) {
    return { ...base, executable: exe, error: `Impossible de lancer Claude Code: ${version.stderr.trim() || version.code}` };
  }
  const v = version.stdout.trim().split(/\s+/)[0] ?? null;

  const auth = await run(exe, ['auth', 'status', '--json']);
  let authenticated: ProviderStatus['authenticated'] = 'unknown';
  let authDetail: string | null = null;
  try {
    const parsed = JSON.parse(auth.stdout) as AuthStatus;
    authenticated = parsed.loggedIn ? 'yes' : 'no';
    authDetail = parsed.loggedIn
      ? [parsed.authMethod, parsed.email, parsed.subscriptionType].filter(Boolean).join(' · ')
      : 'Lancez `claude auth login` ou définissez ANTHROPIC_API_KEY.';
  } catch {
    authDetail = auth.stderr.trim() || auth.stdout.trim() || null;
  }
  return { ...base, installed: true, version: v, executable: exe, authenticated, authDetail };
}
