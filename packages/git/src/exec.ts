import { execFile } from 'node:child_process';
import path from 'node:path';

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly cwd: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed (${exitCode ?? 'signal'}): ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

export interface GitExecOptions {
  cwd: string;
  timeoutMs?: number;
  /** Extra environment; credentials are never injected here. */
  env?: Record<string, string>;
}

/**
 * Runs git with structured arguments and no shell — paths and user input can never
 * be interpreted as shell syntax. Prompts are disabled so a missing credential fails
 * instead of hanging a hidden process.
 */
export function git(args: readonly string[], opts: GitExecOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          ...opts.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
          reject(new GitError([...args], opts.cwd, typeof code === 'number' ? code : null, String(stderr) || error.message));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** Rejects relative, empty, or traversal-prone paths before they reach git. */
export function assertAbsolutePath(p: string, label = 'path'): string {
  if (typeof p !== 'string' || p.length === 0) throw new Error(`${label} is required`);
  if (!path.isAbsolute(p)) throw new Error(`${label} must be absolute: ${p}`);
  if (p.includes('\0')) throw new Error(`${label} contains an invalid character`);
  return path.normalize(p);
}
