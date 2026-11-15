import type { RepositoryIssues } from '@codeo/contracts';
import type { Repository, Task } from '@codeo/domain';
import type { Logger } from '@codeo/shared-utils';
import { GhError, type RemoteIssue } from '../github/gh-cli';
import type { TaskService } from './tasks';
import type { WorkspaceService } from './workspaces';

/** Where a repository's open issues come from: the user's `gh`, or the demo dataset. */
export type IssueSource = (repository: Repository, limit: number) => Promise<RemoteIssue[]>;

const reason = (err: unknown) => (err instanceof GhError ? err.stderr || err.message : err instanceof Error ? err.message : String(err));

/** The ticket key of a GitHub issue, as a task created from it carries it. */
export const issueKey = (number: number) => `#${number}`;

/**
 * GitHub issues as tickets: read live on every call (nothing is stored), one repository at a time failing on its own,
 * and matched to the workspace's tasks by ticket key + repository so the screen shows which ones are already taken.
 */
export class TicketService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly tasks: TaskService,
    private readonly source: IssueSource,
    private readonly log: Logger,
  ) {}

  async listGitHub(workspaceId: string, limit: number): Promise<RepositoryIssues[]> {
    const ws = await this.workspaces.get(workspaceId);
    const taskList = await this.tasks.list(workspaceId);
    return Promise.all(
      ws.repositories.map(async (repo): Promise<RepositoryIssues> => {
        try {
          const issues = await this.source(repo, limit);
          return {
            repositoryId: repo.id,
            repositoryName: repo.name,
            issues: issues.map((i) => ({ ...i, repositoryId: repo.id, key: issueKey(i.number), taskId: taskFor(taskList, repo.id, issueKey(i.number)) })),
            error: null,
          };
        } catch (err) {
          this.log.warn('github issues unavailable', { repositoryId: repo.id, error: reason(err) });
          return { repositoryId: repo.id, repositoryName: repo.name, issues: [], error: reason(err) };
        }
      }),
    );
  }
}

/** The most recently updated task (the order `tasks.list` returns) carrying this key on this repository. */
function taskFor(tasks: Task[], repositoryId: string, key: string): string | null {
  return tasks.find((t) => t.ticketKey === key && t.repositoryIds.includes(repositoryId))?.id ?? null;
}
