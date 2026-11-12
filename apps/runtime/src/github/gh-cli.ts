import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { CICheck, PullRequestStatus } from '@codeo/domain';

/** What the code host tells about a pull request, already normalised to domain vocabulary. */
export interface RemotePullRequest {
  number: number;
  url: string;
  title: string;
  branch: string;
  baseBranch: string;
  status: PullRequestStatus;
  additions: number;
  deletions: number;
  checks: CICheck[];
}

export interface GitHubStatus {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  detail: string | null;
}

/**
 * The code-host operations the runtime needs. The real implementation drives the user's own `gh` CLI
 * (their login, their hosts); tests inject a recording double.
 */
export interface GitHubClient {
  status(): Promise<GitHubStatus>;
  /** The most recent pull request whose head is `branch`, in any state, or null. */
  findByBranch(cwd: string, branch: string): Promise<RemotePullRequest | null>;
  create(cwd: string, input: { base: string; head: string; title: string; body: string; draft: boolean }): Promise<RemotePullRequest>;
  view(cwd: string, url: string): Promise<RemotePullRequest>;
}

export class GhError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly missing = false,
  ) {
    super(message);
    this.name = 'GhError';
  }
}

const PR_FIELDS = 'number,url,title,state,isDraft,headRefName,baseRefName,additions,deletions,reviewDecision,statusCheckRollup';

const CheckRunSchema = z.object({
  __typename: z.literal('CheckRun'),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
});
const StatusContextSchema = z.object({
  __typename: z.literal('StatusContext'),
  context: z.string(),
  state: z.string(),
  targetUrl: z.string().nullable().optional(),
});
export const GhPullRequestSchema = z.object({
  number: z.number().int(),
  url: z.string().url(),
  title: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  additions: z.number().int().default(0),
  deletions: z.number().int().default(0),
  reviewDecision: z.string().nullable().optional(),
  statusCheckRollup: z
    .array(z.union([CheckRunSchema, StatusContextSchema, z.object({ __typename: z.string() }).passthrough()]))
    .nullable()
    .optional(),
});
export type GhPullRequest = z.infer<typeof GhPullRequestSchema>;

function checkRunStatus(status: string, conclusion: string | null | undefined): CICheck['status'] {
  if (status !== 'COMPLETED') return status === 'IN_PROGRESS' ? 'running' : 'queued';
  switch (conclusion) {
    case 'SUCCESS':
    case 'NEUTRAL':
      return 'success';
    case 'SKIPPED':
      return 'skipped';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'failure';
  }
}

function contextStatus(state: string): CICheck['status'] {
  if (state === 'SUCCESS') return 'success';
  if (state === 'PENDING' || state === 'EXPECTED') return 'running';
  return 'failure';
}

/** Maps `gh pr view --json` output to the domain: draft/open/review decision/merged/closed, and every check. */
export function toRemotePullRequest(raw: unknown): RemotePullRequest {
  const pr = GhPullRequestSchema.parse(raw);
  const status: PullRequestStatus =
    pr.state === 'MERGED'
      ? 'merged'
      : pr.state === 'CLOSED'
        ? 'closed'
        : pr.isDraft
          ? 'draft'
          : pr.reviewDecision === 'APPROVED'
            ? 'approved'
            : pr.reviewDecision === 'CHANGES_REQUESTED'
              ? 'changes_requested'
              : 'open';
  const checks: CICheck[] = [];
  for (const c of pr.statusCheckRollup ?? []) {
    const run = CheckRunSchema.safeParse(c);
    if (run.success) {
      checks.push({ name: run.data.name, status: checkRunStatus(run.data.status, run.data.conclusion), url: run.data.detailsUrl ?? null });
      continue;
    }
    const ctx = StatusContextSchema.safeParse(c);
    if (ctx.success) checks.push({ name: ctx.data.context, status: contextStatus(ctx.data.state), url: ctx.data.targetUrl ?? null });
  }
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    branch: pr.headRefName,
    baseBranch: pr.baseRefName,
    status,
    additions: pr.additions,
    deletions: pr.deletions,
    checks,
  };
}

/** Runs `gh` with an argument array (no shell), prompts and update checks disabled. */
function gh(args: readonly string[], cwd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      [...args],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error) {
          const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
          const detail = String(stderr).trim() || error.message;
          reject(new GhError(missing ? 'GitHub CLI (gh) is not installed' : `gh ${args[0] ?? ''} ${args[1] ?? ''} failed: ${detail}`, detail, missing));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

export class GhCliClient implements GitHubClient {
  async status(): Promise<GitHubStatus> {
    let version: string | null = null;
    try {
      version = (await gh(['--version'], process.cwd(), 10_000)).match(/gh version (\S+)/)?.[1] ?? 'unknown';
    } catch (err) {
      return { installed: false, version: null, authenticated: false, detail: err instanceof Error ? err.message : String(err) };
    }
    try {
      await gh(['auth', 'status'], process.cwd(), 15_000);
      return { installed: true, version, authenticated: true, detail: null };
    } catch (err) {
      return { installed: true, version, authenticated: false, detail: err instanceof GhError ? err.stderr : String(err) };
    }
  }

  async findByBranch(cwd: string, branch: string): Promise<RemotePullRequest | null> {
    const out = await gh(['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', PR_FIELDS], cwd);
    const list = z.array(z.unknown()).parse(JSON.parse(out || '[]'));
    return list[0] ? toRemotePullRequest(list[0]) : null;
  }

  async create(cwd: string, input: { base: string; head: string; title: string; body: string; draft: boolean }): Promise<RemotePullRequest> {
    const out = await gh(
      ['pr', 'create', '--base', input.base, '--head', input.head, '--title', input.title, '--body', input.body, ...(input.draft ? ['--draft'] : [])],
      cwd,
      120_000,
    );
    /* `gh pr create` prints the new PR's URL as its last line. */
    const url = out.trim().split('\n').pop()?.trim() ?? '';
    if (!/^https?:\/\//.test(url)) throw new GhError(`gh pr create returned no URL: ${out.trim()}`, out);
    return this.view(cwd, url);
  }

  async view(cwd: string, url: string): Promise<RemotePullRequest> {
    return toRemotePullRequest(JSON.parse(await gh(['pr', 'view', url, '--json', PR_FIELDS], cwd)));
  }
}
