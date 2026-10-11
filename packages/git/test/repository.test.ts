import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorktree, git, inspectRepository, removeWorktree } from '../src/index';

let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'codeo-git-'));
  await git(['init', '-q', '-b', 'main'], { cwd: dir });
  await git(['config', 'user.email', 'test@codeo.local'], { cwd: dir });
  await git(['config', 'user.name', 'Codeo Test'], { cwd: dir });
  writeFileSync(path.join(dir, 'README.md'), '# test\n');
  await git(['add', '.'], { cwd: dir });
  await git(['commit', '-q', '-m', 'init'], { cwd: dir });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('inspectRepository', () => {
  it('describes a repository', async () => {
    const info = await inspectRepository(dir);
    expect(info.isGitRepository).toBe(true);
    expect(info.currentBranch).toBe('main');
    expect(info.defaultBranch).toBe('main');
    expect(info.dirty).toBe(false);
    expect(info.worktrees).toHaveLength(1);
  });
  it('is safe on a non-repository', async () => {
    const info = await inspectRepository(os.tmpdir());
    expect(info.isGitRepository).toBe(false);
  });
  it('rejects relative paths', async () => {
    await expect(inspectRepository('relative/path')).rejects.toThrow(/absolute/);
  });
});

describe('worktrees', () => {
  it('creates an isolated worktree and refuses to delete it while dirty', async () => {
    const wt = path.join(dir, '.worktrees', 'feature-a');
    const info = await createWorktree({ root: dir, path: wt, branch: 'feature/a', baseBranch: 'main' });
    expect(info.branch).toBe('feature/a');
    writeFileSync(path.join(wt, 'dirty.txt'), 'x');
    await expect(removeWorktree(dir, wt)).rejects.toThrow(/uncommitted/);
    await removeWorktree(dir, wt, { force: true });
    expect((await inspectRepository(dir)).worktrees).toHaveLength(1);
  });
  it('rejects dangerous branch names', async () => {
    await expect(
      createWorktree({ root: dir, path: path.join(dir, '.worktrees', 'x'), branch: '--upload-pack=evil', baseBranch: 'main' }),
    ).rejects.toThrow(/Invalid branch/);
  });
});
