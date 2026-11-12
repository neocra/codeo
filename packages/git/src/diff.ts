import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAbsolutePath, git } from './exec';

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface ParsedDiffLine {
  type: DiffLineType;
  old: number | null;
  new: number | null;
  text: string;
}

export interface ParsedHunk {
  header: string;
  lines: ParsedDiffLine[];
}

export type FileChangeStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface FileDiff {
  path: string;
  /** Previous path of a renamed file. */
  oldPath: string | null;
  status: FileChangeStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: ParsedHunk[];
  /** Lines were dropped to respect the line budget (the counts above stay exact). */
  truncated: boolean;
}

export interface DiffLimits {
  /** Lines kept per file before it is truncated. */
  maxLinesPerFile?: number;
  /** Lines kept across all files; files after the budget keep their counts but no hunks. */
  maxTotalLines?: number;
}

const DEFAULT_LIMITS: Required<DiffLimits> = { maxLinesPerFile: 3000, maxTotalLines: 20_000 };

const stripPrefix = (p: string, prefix: 'a/' | 'b/'): string | null =>
  p === '/dev/null' ? null : p.startsWith(prefix) ? p.slice(2) : p;

/** `a/<p> b/<p>`: the only header form that can be split without ambiguity when a path holds spaces. */
function pathFromHeader(rest: string): string | null {
  if (!rest.startsWith('a/')) return null;
  const n = rest.length - 5;
  if (n <= 0 || n % 2 !== 0) return null;
  const p = rest.slice(2, 2 + n / 2);
  return rest === `a/${p} b/${p}` ? p : null;
}

/**
 * Parses `git diff` output (run with `core.quotePath=false`, default `a/` `b/` prefixes) into files and hunks.
 * Pure: no git, no I/O — the UI renders the result as is.
 */
export function parseUnifiedDiff(patch: string, limits: DiffLimits = {}): FileDiff[] {
  const { maxLinesPerFile, maxTotalLines } = { ...DEFAULT_LIMITS, ...limits };
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let fileLines = 0;
  let totalLines = 0;
  let inHeader = false;

  const keep = (f: FileDiff): boolean => {
    if (fileLines >= maxLinesPerFile || totalLines >= maxTotalLines) {
      f.truncated = true;
      return false;
    }
    fileLines++;
    totalLines++;
    return true;
  };

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const fromHeader = pathFromHeader(raw.slice(11));
      file = { path: fromHeader ?? '', oldPath: null, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [], truncated: false };
      files.push(file);
      hunk = null;
      fileLines = 0;
      inHeader = true;
      continue;
    }
    if (!file) continue;
    if (inHeader) {
      if (raw.startsWith('new file mode')) file.status = 'added';
      else if (raw.startsWith('deleted file mode')) file.status = 'deleted';
      else if (raw.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = raw.slice(12);
      } else if (raw.startsWith('rename to ')) file.path = raw.slice(10);
      else if (raw.startsWith('Binary files ')) {
        file.binary = true;
        /* Plain string scanning (no backtracking regex): `Binary files <old> and <new> differ`. */
        if (!file.path && raw.endsWith(' differ')) {
          const pair = raw.slice('Binary files '.length, -' differ'.length);
          const sep = pair.lastIndexOf(' and ');
          if (sep >= 0)
            file.path = stripPrefix(pair.slice(sep + 5), 'b/') ?? stripPrefix(pair.slice(0, sep), 'a/') ?? '';
        }
      } else if (raw.startsWith('--- ')) {
        const p = stripPrefix(raw.slice(4), 'a/');
        if (p && !file.path) file.path = p;
      } else if (raw.startsWith('+++ ')) {
        const p = stripPrefix(raw.slice(4), 'b/');
        if (p && file.status !== 'renamed') file.path = p;
      }
      if (!raw.startsWith('@@')) continue;
      inHeader = false;
    }
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (!m) continue;
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      hunk = { header: raw, lines: [] };
      if (fileLines < maxLinesPerFile && totalLines < maxTotalLines) file.hunks.push(hunk);
      else file.truncated = true;
      continue;
    }
    if (!hunk) continue;
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === '+') {
      file.additions++;
      if (keep(file)) hunk.lines.push({ type: 'add', old: null, new: newLine, text });
      newLine++;
    } else if (sign === '-') {
      file.deletions++;
      if (keep(file)) hunk.lines.push({ type: 'del', old: oldLine, new: null, text });
      oldLine++;
    } else if (sign === ' ') {
      if (keep(file)) hunk.lines.push({ type: 'ctx', old: oldLine, new: newLine, text });
      oldLine++;
      newLine++;
    }
    /* `\ No newline at end of file` and the trailing empty line carry no content. */
  }
  for (const f of files) f.hunks = f.hunks.filter((h) => h.lines.length > 0);
  return files;
}

export interface WorktreeChanges {
  /** The ref the changes are measured against (e.g. the worktree's base branch). */
  base: string;
  /** Common ancestor of `base` and HEAD: work that landed on the base branch since does not show up as a change. */
  mergeBase: string;
  head: string;
  /** Commits on the worktree branch since the merge base. */
  commits: number;
  /** Uncommitted (staged, unstaged, untracked) changes exist on top of HEAD. */
  uncommitted: boolean;
  files: FileDiff[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

/**
 * Everything a worktree changed relative to `base`: its commits AND its uncommitted work, untracked files
 * included (agents usually leave their changes uncommitted). The working tree is snapshotted into a throwaway
 * index file, so the worktree's own index, files and branch are never touched; the only side effect is loose
 * blobs in the object store, which git's normal gc collects.
 */
export async function worktreeChanges(dir: string, base: string, limits: DiffLimits = {}): Promise<WorktreeChanges> {
  const cwd = assertAbsolutePath(dir, 'worktree path');
  if (!base || base.startsWith('-')) throw new Error(`Invalid base ref: ${base}`);
  const head = (await git(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
  const mergeBase = await git(['merge-base', base, 'HEAD'], { cwd })
    .then((r) => r.stdout.trim())
    .catch(async () => (await git(['rev-parse', '--verify', `${base}^{commit}`], { cwd })).stdout.trim());
  const commits = Number((await git(['rev-list', '--count', `${mergeBase}..HEAD`], { cwd })).stdout.trim()) || 0;
  const uncommitted = (await git(['status', '--porcelain', '--untracked-files=normal'], { cwd })).stdout.trim().length > 0;

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'codeo-diff-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
    await git(['read-tree', 'HEAD'], { cwd, env });
    await git(['add', '-A', '--', '.'], { cwd, env, timeoutMs: 120_000 });
    const { stdout } = await git(
      ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/', mergeBase],
      { cwd, env, timeoutMs: 120_000 },
    );
    const files = parseUnifiedDiff(stdout, limits);
    return {
      base,
      mergeBase,
      head,
      commits,
      uncommitted,
      files,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      truncated: files.some((f) => f.truncated),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
