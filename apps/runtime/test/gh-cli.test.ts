import { describe, expect, it } from 'vitest';
import { toRemoteIssues, toRemotePullRequest } from '../src/github/gh-cli';
import { defaultPullRequestText } from '../src/services/pull-requests';

const base = {
  number: 42,
  url: 'https://github.com/acme/app/pull/42',
  title: 'PROJ-7: Réparer le login',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'codeo/proj-7-reparer-le-login-0123abcd',
  baseRefName: 'main',
  additions: 12,
  deletions: 3,
  reviewDecision: '',
  statusCheckRollup: [],
};

describe('gh pr view mapping', () => {
  it('maps state, draft and review decision to the domain status', () => {
    expect(toRemotePullRequest(base).status).toBe('open');
    expect(toRemotePullRequest({ ...base, isDraft: true }).status).toBe('draft');
    expect(toRemotePullRequest({ ...base, reviewDecision: 'APPROVED' }).status).toBe('approved');
    expect(toRemotePullRequest({ ...base, reviewDecision: 'CHANGES_REQUESTED' }).status).toBe('changes_requested');
    expect(toRemotePullRequest({ ...base, state: 'MERGED' }).status).toBe('merged');
    expect(toRemotePullRequest({ ...base, state: 'CLOSED', isDraft: true }).status).toBe('closed');
  });

  it('maps check runs and commit statuses, ignoring unknown entries', () => {
    const pr = toRemotePullRequest({
      ...base,
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/1' },
        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: null },
        { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: null },
        { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', targetUrl: 'https://ci/2' },
        { __typename: 'SomethingNew', foo: 1 },
      ],
    });
    expect(pr.checks).toEqual([
      { name: 'test', status: 'success', url: 'https://ci/1' },
      { name: 'lint', status: 'failure', url: null },
      { name: 'e2e', status: 'running', url: null },
      { name: 'docs', status: 'skipped', url: null },
      { name: 'deploy', status: 'running', url: 'https://ci/2' },
    ]);
    expect(pr).toMatchObject({ number: 42, branch: base.headRefName, baseBranch: 'main', additions: 12, deletions: 3 });
  });

  it('rejects malformed output at the boundary', () => {
    expect(() => toRemotePullRequest({ ...base, url: 'not a url' })).toThrow();
    expect(() => toRemotePullRequest({ ...base, state: 'WEIRD' })).toThrow();
  });
});

describe('gh issue list mapping', () => {
  it('keeps the fields a ticket needs, newest update first', () => {
    const issues = toRemoteIssues([
      { number: 3, title: 'Ancien', body: null, url: 'https://github.com/acme/app/issues/3', labels: [], author: null, updatedAt: '2026-11-01T00:00:00Z' },
      { number: 9, title: 'Récent', body: 'Détail', url: 'https://github.com/acme/app/issues/9', labels: [{ name: 'bug', color: 'red' }], author: { login: 'octo', is_bot: false }, updatedAt: '2026-11-14T00:00:00Z' },
    ]);
    expect(issues).toEqual([
      { number: 9, title: 'Récent', body: 'Détail', url: 'https://github.com/acme/app/issues/9', labels: ['bug'], author: 'octo', updatedAt: '2026-11-14T00:00:00Z' },
      { number: 3, title: 'Ancien', body: '', url: 'https://github.com/acme/app/issues/3', labels: [], author: null, updatedAt: '2026-11-01T00:00:00Z' },
    ]);
  });

  it('refuses output that is not an issue list', () => {
    expect(() => toRemoteIssues([{ number: 'x' }])).toThrow();
  });
});

describe('pull request text', () => {
  const task = (ticketKey: string | null) => ({ ticketKey, title: 'Réparer le login', objective: 'Le bouton ne répond plus.', subtasks: [] }) as unknown as Parameters<typeof defaultPullRequestText>[0];

  it('closes the GitHub issue a task was taken from', () => {
    expect(defaultPullRequestText(task('#42'))).toEqual({ title: '#42: Réparer le login', body: 'Le bouton ne répond plus.\n\nCloses #42\n\nCréée avec Codeo.' });
  });

  it('does not close anything for another ticket key', () => {
    expect(defaultPullRequestText(task('PROJ-7')).body).not.toContain('Closes');
    expect(defaultPullRequestText(task(null)).body).not.toContain('Closes');
  });
});
