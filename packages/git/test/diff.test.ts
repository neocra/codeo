import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorktree, git, parseUnifiedDiff, worktreeChanges } from '../src/index';

describe('parseUnifiedDiff', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,3 @@ export function a() {',
    ' const x = 1;',
    '-const y = 2;',
    '+const y = 3;',
    ' return x;',
    'diff --git a/new file.md b/new file.md',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/new file.md',
    '@@ -0,0 +1,2 @@',
    '+# Titre',
    '+texte',
    '\\ No newline at end of file',
    'diff --git a/old.txt b/renamed.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to renamed.txt',
    'diff --git a/img.png b/img.png',
    'new file mode 100644',
    'index 0000000..4444444',
    'Binary files /dev/null and b/img.png differ',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    'index 5555555..0000000',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    '',
  ].join('\n');

  it('reads files, statuses, line numbers and counts', () => {
    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual([
      ['src/a.ts', 'modified', 1, 1, false],
      ['new file.md', 'added', 2, 0, false],
      ['renamed.txt', 'renamed', 0, 0, false],
      ['img.png', 'added', 0, 0, true],
      ['gone.txt', 'deleted', 0, 1, false],
    ]);
    expect(files[2]?.oldPath).toBe('old.txt');
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { type: 'ctx', old: 1, new: 1, text: 'const x = 1;' },
      { type: 'del', old: 2, new: null, text: 'const y = 2;' },
      { type: 'add', old: null, new: 2, text: 'const y = 3;' },
      { type: 'ctx', old: 3, new: 3, text: 'return x;' },
    ]);
    expect(files[1]?.hunks[0]?.lines.map((l) => l.text)).toEqual(['# Titre', 'texte']);
  });

  it('truncates past the line budget but keeps exact counts', () => {
    const files = parseUnifiedDiff(patch, { maxLinesPerFile: 2 });
    expect(files[0]?.truncated).toBe(true);
    expect(files[0]?.hunks[0]?.lines).toHaveLength(2);
    expect(files[0]?.additions).toBe(1);
    expect(files[0]?.deletions).toBe(1);
  });
});

describe('worktreeChanges', () => {
  let repo: string;
  let wtRoot: string;
  beforeAll(async () => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'codeo-diff-repo-'));
    wtRoot = mkdtempSync(path.join(os.tmpdir(), 'codeo-diff-wt-'));
    await git(['init', '-q', '-b', 'main'], { cwd: repo });
    await git(['config', 'user.email', 'test@codeo.local'], { cwd: repo });
    await git(['config', 'user.name', 'Codeo Test'], { cwd: repo });
    writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    writeFileSync(path.join(repo, 'b.txt'), 'bee\n');
    await git(['add', '.'], { cwd: repo });
    await git(['commit', '-q', '-m', 'init'], { cwd: repo });
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wtRoot, { recursive: true, force: true });
  });

  it('includes commits, uncommitted edits and untracked files, without touching the index', async () => {
    const wt = path.join(wtRoot, 'lane');
    await createWorktree({ root: repo, path: wt, branch: 'codeo/lane', baseBranch: 'main' });
    writeFileSync(path.join(wt, 'committed.txt'), 'c\n');
    await git(['add', 'committed.txt'], { cwd: wt });
    await git(['commit', '-q', '-m', 'agent commit'], { cwd: wt });
    writeFileSync(path.join(wt, 'a.txt'), 'one\nTWO\n');
    unlinkSync(path.join(wt, 'b.txt'));
    writeFileSync(path.join(wt, 'untracked.txt'), 'new\n');
    /* Work that lands on main after the branch point is not the agent's change. */
    writeFileSync(path.join(repo, 'later.txt'), 'later\n');
    await git(['add', 'later.txt'], { cwd: repo });
    await git(['commit', '-q', '-m', 'later on main'], { cwd: repo });

    const statusBefore = (await git(['status', '--porcelain'], { cwd: wt })).stdout;
    const changes = await worktreeChanges(wt, 'main');
    expect(changes.commits).toBe(1);
    expect(changes.uncommitted).toBe(true);
    expect(changes.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ['a.txt', 'modified'],
      ['b.txt', 'deleted'],
      ['committed.txt', 'added'],
      ['untracked.txt', 'added'],
    ]);
    expect(changes.additions).toBe(3);
    expect(changes.deletions).toBe(2);
    expect((await git(['status', '--porcelain'], { cwd: wt })).stdout).toBe(statusBefore);
    expect(readFileSync(path.join(wt, 'a.txt'), 'utf8')).toBe('one\nTWO\n');
  });
});
