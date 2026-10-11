import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertAbsolutePath, git, GitError } from './exec';

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
}

export interface RepositoryInfo {
  path: string;
  isGitRepository: boolean;
  root: string | null;
  name: string;
  currentBranch: string | null;
  defaultBranch: string | null;
  remoteUrl: string | null;
  dirty: boolean;
  worktrees: WorktreeInfo[];
}

export async function findRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await git(['rev-parse', '--show-toplevel'], { cwd: dir });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function currentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
    const b = stdout.trim();
    return b === 'HEAD' ? null : b;
  } catch {
    return null;
  }
}

export async function defaultBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root });
    const ref = stdout.trim();
    if (ref) return ref.replace(/^origin\//, '');
  } catch {
    /* no remote HEAD — fall through */
  }
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      await git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], { cwd: root });
      return candidate;
    } catch {
      /* next */
    }
  }
  return currentBranch(root);
}

export async function remoteUrl(root: string): Promise<string | null> {
  try {
    const { stdout } = await git(['remote', 'get-url', 'origin'], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isDirty(root: string): Promise<boolean> {
  const { stdout } = await git(['status', '--porcelain', '--untracked-files=normal'], { cwd: root });
  return stdout.trim().length > 0;
}

export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const { stdout } = await git(['worktree', 'list', '--porcelain'], { cwd: root });
  const out: WorktreeInfo[] = [];
  let cur: Partial<WorktreeInfo> = {};
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9), branch: null };
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === '' && cur.path) {
      out.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? '' });
      cur = {};
    }
  }
  if (cur.path) out.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? '' });
  return out;
}

export async function listBranches(root: string): Promise<string[]> {
  const { stdout } = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: root });
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Inspects any directory: safe to call on non-repositories. */
export async function inspectRepository(dir: string): Promise<RepositoryInfo> {
  const p = assertAbsolutePath(dir);
  const base: RepositoryInfo = {
    path: p,
    isGitRepository: false,
    root: null,
    name: path.basename(p),
    currentBranch: null,
    defaultBranch: null,
    remoteUrl: null,
    dirty: false,
    worktrees: [],
  };
  if (!existsSync(p) || !statSync(p).isDirectory()) return base;
  const root = await findRoot(p);
  if (!root) return base;
  const [branch, def, remote, dirty, worktrees] = await Promise.all([
    currentBranch(root),
    defaultBranch(root),
    remoteUrl(root),
    isDirty(root).catch(() => false),
    listWorktrees(root).catch(() => []),
  ]);
  return {
    ...base,
    isGitRepository: true,
    root,
    name: path.basename(root),
    currentBranch: branch,
    defaultBranch: def,
    remoteUrl: remote,
    dirty,
    worktrees,
  };
}

export interface CreateWorktreeOptions {
  root: string;
  /** Absolute directory for the new worktree (must not exist). */
  path: string;
  branch: string;
  baseBranch: string;
}

/** Creates an isolated worktree on a new branch. Never touches an existing directory. */
export async function createWorktree(opts: CreateWorktreeOptions): Promise<WorktreeInfo> {
  const root = assertAbsolutePath(opts.root, 'root');
  const target = assertAbsolutePath(opts.path, 'worktree path');
  if (existsSync(target)) throw new Error(`Worktree target already exists: ${target}`);
  if (!/^[\w./-]+$/.test(opts.branch) || opts.branch.startsWith('-')) throw new Error(`Invalid branch name: ${opts.branch}`);
  await git(['worktree', 'add', '-b', opts.branch, target, opts.baseBranch], { cwd: root, timeoutMs: 120_000 });
  const { stdout } = await git(['rev-parse', 'HEAD'], { cwd: target });
  return { path: target, branch: opts.branch, head: stdout.trim() };
}

/**
 * Removes a worktree. Refuses when the worktree has uncommitted changes unless `force`
 * is explicitly set by an authorized caller — user changes are never deleted silently.
 */
export async function removeWorktree(root: string, worktreePath: string, opts: { force?: boolean } = {}): Promise<void> {
  const r = assertAbsolutePath(root, 'root');
  const w = assertAbsolutePath(worktreePath, 'worktree path');
  if (!opts.force && existsSync(w) && (await isDirty(w))) {
    throw new Error(`Worktree ${w} has uncommitted changes; refusing to remove without explicit force`);
  }
  const args = ['worktree', 'remove', ...(opts.force ? ['--force'] : []), w];
  await git(args, { cwd: r, timeoutMs: 60_000 });
}

export interface DiffStat {
  file: string;
  additions: number;
  deletions: number;
}

export async function diffStat(root: string, base?: string): Promise<DiffStat[]> {
  const args = ['diff', '--numstat', ...(base ? [base] : [])];
  const { stdout } = await git(args, { cwd: root });
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t');
      return { file: rest.join('\t'), additions: Number(a) || 0, deletions: Number(d) || 0 };
    });
}

export async function unifiedDiff(root: string, opts: { base?: string; file?: string } = {}): Promise<string> {
  const args = ['diff', '--no-color', ...(opts.base ? [opts.base] : []), ...(opts.file ? ['--', opts.file] : [])];
  const { stdout } = await git(args, { cwd: root });
  return stdout;
}

export { GitError };
