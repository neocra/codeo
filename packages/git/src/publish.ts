import { assertAbsolutePath, git } from './exec';
import { isDirty } from './repository';

const SAFE_BRANCH = /^[\w./-]+$/;

function assertBranch(branch: string): string {
  if (!SAFE_BRANCH.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error(`Invalid branch name: ${branch}`);
  return branch;
}

/**
 * Commits everything in the working tree (tracked edits, deletions, untracked files honouring .gitignore)
 * with the repository's own identity and hooks. Returns the new commit, or null when there was nothing to commit.
 */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  const d = assertAbsolutePath(dir);
  if (!message.trim()) throw new Error('A commit message is required');
  if (!(await isDirty(d))) return null;
  await git(['add', '--all'], { cwd: d, timeoutMs: 120_000 });
  /* `-F -` would need stdin; `-m` with an argument array is just as safe (no shell). */
  await git(['commit', '--quiet', '-m', message], { cwd: d, timeoutMs: 120_000 });
  return (await git(['rev-parse', 'HEAD'], { cwd: d })).stdout.trim();
}

/** Commits reachable from HEAD but not from `base`. */
export async function commitsAhead(dir: string, base: string): Promise<number> {
  const d = assertAbsolutePath(dir);
  if (!base || base.startsWith('-')) throw new Error(`Invalid base ref: ${base}`);
  const { stdout } = await git(['rev-list', '--count', `${base}..HEAD`], { cwd: d });
  return Number(stdout.trim()) || 0;
}

/**
 * Pushes `branch` to the same branch on `remote` and sets it as upstream. Never forces: a remote branch that
 * diverged is reported, not overwritten. Credentials come from the user's own git configuration (no prompt).
 */
export async function pushBranch(dir: string, branch: string, remote = 'origin'): Promise<void> {
  const d = assertAbsolutePath(dir);
  assertBranch(branch);
  if (!/^[\w.-]+$/.test(remote) || remote.startsWith('-')) throw new Error(`Invalid remote: ${remote}`);
  await git(['push', '--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`], { cwd: d, timeoutMs: 180_000 });
}
