import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { branchExists, createWorktree, forgetMissingWorktree, git, inspectRepository, removeWorktree, resolveCommit, worktreeIdentity } from '../src/index';

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
  it('reattaches an existing branch so its commits survive a worktree removal', async () => {
    const wt = path.join(dir, '.worktrees', 'feature-b');
    await createWorktree({ root: dir, path: wt, branch: 'feature/b', baseBranch: 'main' });
    writeFileSync(path.join(wt, 'b.txt'), 'b');
    await git(['add', '.'], { cwd: wt });
    await git(['commit', '-q', '-m', 'b'], { cwd: wt });
    const head = await resolveCommit(wt, 'HEAD');
    await removeWorktree(dir, wt);
    expect(await branchExists(dir, 'feature/b')).toBe(true);
    const again = await createWorktree({ root: dir, path: wt, branch: 'feature/b', baseBranch: 'main' });
    expect(again.head).toBe(head);
    await removeWorktree(dir, wt);
  });
  it('resolves commits and tolerates unknown refs', async () => {
    expect(await resolveCommit(dir, 'main')).toMatch(/^[0-9a-f]{40}$/);
    expect(await resolveCommit(dir, 'nope')).toBeNull();
    expect(await resolveCommit(dir, '--output=/tmp/x')).toBeNull();
  });
  it('lists worktrees whose paths contain non-ASCII characters verbatim', async () => {
    const wt = path.join(dir, '.worktrees', 'été-ñ');
    await createWorktree({ root: dir, path: wt, branch: 'feature/accents', baseBranch: 'main' });
    /* git prints forward slashes on every platform; compare separator-agnostically. */
    const listed = (await inspectRepository(dir)).worktrees.map((w) => w.path.replace(/\\/g, '/'));
    expect(listed.some((p) => p.endsWith('/.worktrees/été-ñ'))).toBe(true);
    await removeWorktree(dir, wt, { force: true });
  });

  it('tells a real worktree from a plain folder at a worktree path', async () => {
    const wt = path.join(dir, '.worktrees', 'identity');
    await createWorktree({ root: dir, path: wt, branch: 'feature/identity', baseBranch: 'main' });
    const id = await worktreeIdentity(wt);
    expect(id?.branch).toBe('feature/identity');
    /* Canonical paths: macOS maps /tmp to /private/tmp, Windows temp dirs use 8.3 short names (.native expands them). */
    expect(realpathSync.native(id!.commonDir)).toBe(realpathSync.native((await worktreeIdentity(dir))!.commonDir));
    rmSync(wt, { recursive: true, force: true });
    /* A plain folder inside the repository reports the repository itself (branch main), never the worktree's branch… */
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, 'intrus.txt'), 'x');
    expect((await worktreeIdentity(wt))?.branch).toBe('main');
    rmSync(wt, { recursive: true, force: true });
    /* …and a plain folder outside any repository is not a working tree at all. */
    const outside = mkdtempSync(path.join(os.tmpdir(), 'codeo-plain-'));
    expect(await worktreeIdentity(outside)).toBeNull();
    rmSync(outside, { recursive: true, force: true });
    await git(['worktree', 'prune'], { cwd: dir });
  });

  it('forgets one missing worktree registration and keeps the others', async () => {
    const a = path.join(dir, '.worktrees', 'gone');
    const b = path.join(dir, '.worktrees', 'kept');
    await createWorktree({ root: dir, path: a, branch: 'feature/gone', baseBranch: 'main' });
    await createWorktree({ root: dir, path: b, branch: 'feature/kept', baseBranch: 'main' });
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    await expect(forgetMissingWorktree(dir, path.join(dir, 'README.md'))).rejects.toThrow(/still exists/);
    await forgetMissingWorktree(dir, a);
    const left = (await inspectRepository(dir)).worktrees.map((w) => w.branch);
    expect(left).not.toContain('feature/gone');
    expect(left).toContain('feature/kept');
    await forgetMissingWorktree(dir, b);
  });

  it('rejects dangerous branch names', async () => {
    await expect(
      createWorktree({ root: dir, path: path.join(dir, '.worktrees', 'x'), branch: '--upload-pack=evil', baseBranch: 'main' }),
    ).rejects.toThrow(/Invalid branch/);
  });
});
