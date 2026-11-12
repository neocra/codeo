# Progress

_Updated: 2026-11-12_

## Current milestone: Phase 6 — remote access (in progress)

### Phase 6, step 1: runtime relay client + desktop pairing (done and verified)
- `apps/runtime/src/remote/`: `gateway-api.ts` (register, pairing start, device list, revoke; runtime secret only in
  `Authorization: Bearer`, every response parsed with zod) and `relay-client.ts`, the outbound socket to
  `/v1/runtimes/<id>/connect`: answers the gateway's `hello` with `welcome`, replays the events the gateway is missing
  (in order, live events queued meanwhile), streams events, answers forwarded requests with the remote scopes
  (`read`, `session:write`, `approval:decide` — never `workspace:admin`, whatever the gateway says), heartbeat, reconnect
  with backoff (1 s → 30 s); a refused secret (401/403 or close 4003) stops retrying and reports `unauthorized`.
- `RemoteService`: registration stored in `settings` (`remote`; the secret is never returned by a command), reconnects at
  boot when left on, re-registers when the gateway changes or refused the secret, closes first at shutdown. Plain HTTP is
  only accepted for a gateway on localhost.
- Commands `remote.status` (read), `remote.enable` / `remote.disable` / `remote.pairingStart` / `remote.devices` /
  `remote.revokeDevice` (`workspace:admin`, so never reachable from a phone); event `RemoteStatusChanged`.
  Approvals decided through the gateway are recorded as `mobile`. The local server and the relay share `executeRequest`.
- Desktop Settings → "Remote access" card: gateway URL, status pill + last error, turn on/off, "Pair a phone" (QR code
  rendered from tokens, dark on light in both themes, 6-digit code, countdown, closes itself when the phone appears),
  paired devices (online/offline/revoked, paired/last seen) with two-step revocation. Devices poll every 30 s (2 s while
  a code is shown) because the gateway does not notify pairings.

## Phase 5 — review and pull requests (done)

### Phase 5, step 4: review loop — request changes (done and verified)
- Command `tasks.requestChanges` (`session:write`): general feedback and/or inline diff comments (`path`, `line`,
  `side` new/old, the quoted line, the comment) are sent back to one lane's agent as its next turn, in its own
  session and worktree. The task moves `review` → `running` and returns to `review` when the agent is done; each
  round is counted on the subtask (`reviewRounds`, JSON column, no migration). The prompt (French, like the others)
  lists the feedback, then the comments grouped by file and ordered by line.
- Target: `subtaskId` (a completed step no later step built on — parallel lane, Best-of-N candidate); omitted, the
  runtime picks the only revisable step (single, or the last step of a sequential/pipeline lane) and asks otherwise.
- Failure handling: a revision turn that fails or is stopped returns the lane to review with the reason
  (`revising` flag) instead of failing the task — the reviewed work is untouched. The next request after a failed
  turn closes the old handle and starts a fresh agent in the same worktree (original instructions + feedback);
  same fallback when a provider conversation cannot be resumed at all. Nothing startable → the task stays in review.
- Desktop Review screen: click a diff line to comment (inline composer, ⌘/Ctrl+Enter, Esc), comments shown under
  their line and removable, a "Request changes" panel per lane (general feedback + comment count), a "Review round N"
  pill, a banner with "Follow the session" while the agent works, and a warning when a revision failed.
  `DiffView` gained `onLineSelect` / `renderAfterLine` (keyboard-accessible selectable lines).

### Phase 5, step 3: pull request follow-up (done and verified)
- Background refresh: every 2 minutes (`pullRequestRefreshMs`, `0` disables) the runtime re-reads every PR GitHub
  can still change (draft/open/changes requested/approved) with the user's `gh`; nothing is asked while `gh` is
  missing or logged out, one failing PR never stops the others, and `PullRequestUpdated` is only published when
  something changed (status, checks, title, size, dependencies). The pass in flight is awaited at shutdown.
- Cleanup after merge: once a PR is merged (background pass or manual refresh), its lane's worktree is removed
  through the same guarded path as `worktrees.remove` — never forced: uncommitted work or an agent at work keeps
  it, and it is retried on the next pass. The branch is always kept.
- PR dependencies for parallel lanes: lanes are published in plan order; a lane whose subtask `dependsOn` other
  subtasks gets their PRs in `dependsOn`, and a new PR's description lists them ("Dépend de :" + URLs).
- Desktop: PR badge (`PR #12, #13`) on the task list, an "Open pull requests" card on Home (`home.summary`
  `openPullRequests`), each PR row shows the PRs it depends on and when it was last read from GitHub.

### Phase 5, step 2: pull requests from reviewed tasks (done and verified)
- `@codeo/git` `commitAll` (tracked + untracked, honours `.gitignore`, the repository's own identity and hooks),
  `commitsAhead`, `pushBranch` (`--set-upstream`, refspec `refs/heads/b:refs/heads/b`, never forced).
- GitHub through the user's own `gh` CLI (`apps/runtime/src/github/gh-cli.ts`, `execFile`, prompts disabled):
  `status`, `findByBranch`, `create`, `view`; `gh pr view --json` is validated with zod and mapped to the domain
  (draft/open/approved/changes requested/merged/closed; check runs and commit statuses → `CICheck`).
- Commands `github.status` (read), `pullRequests.create` (`workspace:admin`), `pullRequests.list`,
  `pullRequests.refresh` (read); events `PullRequestCreated` / `PullRequestUpdated`; table `pull_requests`
  (migration 0004, unique URL). Only a `completed` task is published; Best-of-N publishes the winner's worktree
  only; each lane is committed → pushed → PR opened (or the PR already open for the branch is adopted) under
  the worktree lock. Re-running is idempotent and publishes later work on the same PR; lanes without work are
  reported as `skipped`. Missing or logged-out `gh` is reported as such before anything is committed.
- Desktop Review screen: completed tasks stay listed; "Create the pull request" (title, description, draft)
  replaces the placeholder; each PR shows status, CI summary, refresh and "Open on GitHub"; a workspace-wide
  "Pull requests" card lists every PR.

### Phase 5, step 1: review on real worktree diffs (done and verified)
- `@codeo/git` `worktreeChanges(dir, base)`: everything a worktree changed since its merge base with the base
  branch — its commits **and** its uncommitted work, untracked files included — computed through a throwaway
  index file (`GIT_INDEX_FILE`), so the worktree's index, files and branch are never touched. `parseUnifiedDiff`
  turns the patch into files/hunks/lines with exact counts and a line budget (3,000 per file, 20,000 total).
- Command `worktrees.diff` (scope `read`); the base ref is resolved in the repository itself.
- Command `tasks.complete` (`review` → `completed`, progress 100): Best-of-N requires `winnerSubtaskId`, a
  completed candidate, stored on the task (`tasks.winner_subtask_id`, migration 0003); other modes refuse one.
  Idle agents are released (session `completed`, note `taskCompleted`); worktrees and branches are kept.
- Desktop Review screen: tasks in review, per-lane diff (branch ← base, +/−, commits, uncommitted badge,
  collapsible files rendered with `DiffView`), Best-of-N candidate tabs with "Keep this proposal", "Complete the
  task" otherwise; Task detail links to it. PR creation is shown as a labelled phase 5 placeholder.

## Phase 4 — worktree isolation + orchestration modes

### Phase 4 (done and verified)
- Each task runs its agents in Git worktrees under `<dataDir>/worktrees/<repoId>/…` (never inside the
  user's repository), on `codeo/<ticket-title-slug>-<taskid8>` branches created from the default branch.
  `isolation: 'none'` keeps the old in-repository behaviour (and is applied to pre-existing tasks by migration 0001).
- Orchestration modes: `single`, `sequential` (shared worktree, one step after another), `pipeline`
  (same + previous steps' output handed to the next prompt), `parallel` (one worktree per subtask,
  `dependsOn` DAG, max 4 concurrent), `best-of-n` (same objective, separate worktrees, review if ≥1 succeeds).
  Rules are pure functions in `packages/domain/src/orchestration.ts`.
- Task engine (`apps/runtime/src/services/tasks.ts`): per-task serialized mutations, blocked steps cancelled
  when a dependency fails, retry of a failed task reuses its worktrees, pause/resume of every running agent,
  idle agents disconnecting at shutdown no longer pause a task in review.
- Commands `worktrees.list` / `worktrees.remove` (refused while dirty unless `force`, refused while an agent
  works in it; the branch is always kept). Events `WorktreeCreated` / `WorktreeRemoved`. `tasks.start` now
  returns `sessions[]`.
- Desktop: orchestration mode + isolation + per-agent plan (provider, role, title, instructions, repository,
  dependencies) in the create dialog; task detail with each agent's status, branch, session, worktree removal
  (two-step confirmation when dirty), start/retry/pause/resume/cancel.

### Done and verified
- pnpm + Turborepo monorepo, TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Official design integrated from the start: tokens extracted from the Codeo Motion artifact, the 11
  components ported to TypeScript React with the artifact's CSS, app chrome built from tokens only.
- Domain entities + state machines with tests.
- Runtime protocol (commands with scopes, sequenced events, replay) with tests.
- Runtime: workspaces (git inspection), sessions (streaming transcript, persistence, reopen, cancel),
  approvals (single decision, expiry, restart safety), tasks (single-subtask orchestration), event log.
  End-to-end test drives the protocol over a real WebSocket with a deterministic fake provider.
- Claude Code adapter on the official Agent SDK; Codex adapter on the official Codex SDK; both detect
  the real install/auth state of this machine.
- Electron desktop: sandboxed renderer, typed preload bridge, runtime child process, screens Home,
  Workspaces, Tasks (create + start), Sessions (live chat, tool calls, approvals, stop), Settings
  (provider detection), plus clearly labelled placeholders for Tickets, Review, Plugins.
- Mobile foundation (Expo) and Gateway skeleton (see their READMEs).

### Known limitations
- Remote access: the phone side of QR pairing is not built yet (desktop shows the code; pairing was exercised with a
  scripted device). Gateway registrations live in the gateway's memory store, so a gateway restart means turning remote
  access on again (the runtime then reports `unauthorized`). No certificate pinning, no push notifications.
- Tickets (Jira/GitHub), Plugins: phase 5/8 — screens exist as labelled placeholders.
- Pull requests: GitHub only (via `gh`, so github.com and GHE hosts `gh` is logged in to); status and checks are polled every 2 minutes (no webhooks); merging is done on GitHub; parallel lanes target the base branch (dependent PRs are linked in their description, not stacked on each other's branch). The remote is always `origin`. Dependencies are only written into the description when a PR is created.
- Worktrees: cleaned up automatically only once their PR is merged (and only when clean); otherwise removal is manual from the task detail. Completing a Best-of-N task records the winner but does not remove the losing candidates' worktrees. Local branches are never deleted.
- Standalone sessions (`sessions.start`, Sessions screen) still run in the repository root.
- Review comments are not persisted as drafts (they live in the screen until sent) and are not posted to GitHub PRs; after completion, iterate with a new task.
- Demo mode with the Elyndor / Codeo Cloud datasets: not yet implemented.
- Codex approvals: the Codex SDK drives `codex exec`, which has no permission callback; sessions rely on Codex's own sandbox (`workspace-write`).
- Packaging: `release.yml` builds unsigned installers for macOS/Windows/Linux on each GitHub release and the app can check/install updates (see `docs/development/releases.md`); macOS self-update needs signing secrets.
- Mascot asset missing from the artifact (see `docs/design/README.md`).

### Next priorities
1. Mobile pairing by QR (phase 6, step 2): scan with `expo-camera`, `pairing/complete`, gateway transport in
   `@codeo/remote-client` (Bearer header, access-token refresh with rotation), secure storage of the refresh token.
2. Demo mode dataset, clearly separated from live data (open PR neocra/codeo#10 needs a rebase).

## Verification log — 2026-11-12 (phase 6, relay client)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 146 tests passed, 0 failed (runtime 38, incl. `remote.test.ts` through a real in-process gateway: register → dial out → QR pairing → phone reads, gets events, starts a session and approves (`decidedBy: mobile`), `workspace:admin` refused at the gateway and in the runtime → revoke cuts the phone → disable/re-enable keeps the registration → reconnect after the gateway drops it; a refused secret stops retrying) |
| `pnpm lint` | 0 errors |
| `tsup` runtime bundle, `electron-vite build` | built |
| Running Electron app + real local gateway (`apps/gateway`, port 8787) | turned on from Settings → connected; QR + code shown; a scripted phone paired with the code, got `welcome` with 3 scopes, `runtime.info` ok, `remote.pairingStart` refused (FORBIDDEN); device listed online; revoked from the UI → phone socket closed 4003; gateway stopped → "Gateway unreachable", retrying |

## Verification log — 2026-11-12 (phase 5, review loop)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 137 tests passed, 0 failed (runtime 32: feedback + inline comments become the same agent's next turn and the task returns to review, rounds counted, refused outside review; lane choice and dependents rule on a parallel task; a failed revision turn returns to review with its reason and the next request starts a fresh agent in the same worktree) |
| `pnpm lint` | 0 errors |
| `tsup` runtime bundle, `electron-vite build` | built |
| Running Electron app + real Claude Code, seeded demo repo | two inline comments + feedback sent from the Review screen; the seed's fake conversation id could not be resumed → lane back in review with the provider's error; resent → a fresh Claude Code agent in the same worktree escaped CSV fields (RFC 4180), added the currency column and a test; task back in review at round 3 |

## Verification log — 2026-11-12 (phase 5, PR follow-up)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 134 tests passed, 0 failed (runtime 29: merged winner's worktree removed and branch kept on refresh; parallel lanes published in plan order with `dependsOn` + "Dépend de" in the body; background pass quiet when nothing changed, announces changes, keeps a dirty merged lane and cleans it on a later pass without calling GitHub) |
| `pnpm lint` | 0 errors |
| `tsup` runtime bundle, `electron-vite build` | built |

Not verified in this session: the poller against the real `gh` on a real PR, the Tasks badge and Home card clicked through in the running Electron app (typechecked and built only).

## Verification log — 2026-11-12 (phase 5, pull requests)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 133 tests passed, 0 failed (git 14 incl. commit + push to a bare remote; runtime 28 incl. `gh` output mapping and end-to-end Best-of-N → complete → PR: only the winner committed and pushed to a real bare `origin`, unauthenticated `gh` refused, re-run updates the same PR, refresh to merged, empty task skipped) |
| `pnpm lint` | 0 errors |
| `tsup` runtime bundle, `electron-vite build` | built; `dist/migrations` contains `0004_pull_requests.sql` |
| Real `gh` 2.97.0, read-only | `status` → installed + authenticated; `view` of neocra/codeo#11 → `merged`, 7 checks mapped; `findByBranch` finds it |

Not verified in this session: creating a real PR on GitHub (end-to-end uses a recording double for `gh`; nothing was published), the Review/PR panel clicked through in the running Electron app (typechecked and built only).

## Verification log — 2026-11-12 (phase 5, review)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 128 tests passed, 0 failed (git 13 incl. a real worktree diff with commit + edit + delete + untracked + later work on main; runtime 24 incl. diff → complete → agents released, Best-of-N winner rules) |
| `pnpm lint` | 0 errors |
| `tsup` runtime bundle, `electron-vite build` | built; `dist/migrations` contains `0003_review_winner.sql` |

Not verified in this session: the Review screen clicked through in the running Electron app (typechecked and built only); a diff on a real Claude Code / Codex worktree.

## Verification log — 2026-10-11 (phase 4)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 101 tests passed, 0 failed (was 85; domain 19, git 7, database 4, runtime 15, …) |
| `pnpm lint` | 0 errors, 0 warnings on changed files |
| Runtime e2e over WebSocket (fake provider) | single in worktree, pipeline handoff in one shared worktree, parallel DAG in 3 worktrees, best-of-N surviving a crashed candidate, sequential failure → blocked steps cancelled → retry reuses worktree, pause/resume, dirty-worktree removal guard, review task survives shutdown |
| Real Claude Code session through the scheduler | task in a temp repo → session cwd = worktree path, agent read the committed file from the worktree and reported the worktree dir as its cwd |
| `tsup` runtime bundle, `electron-vite build` | built; `dist/migrations` contains `0001_worktree_orchestration.sql` |

Not verified in this session: the new desktop dialog/detail clicked through in the running Electron app (typechecked and built only); Codex inside a worktree.

## Verification log — 2026-10-11 (phases 1–3)

| Check | Result |
| --- | --- |
| `tsc --noEmit` on all 17 packages/apps | clean |
| `vitest` (15 suites) | 85 tests passed, 0 failed |
| `eslint .` | 0 errors |
| `tsup` runtime bundle + standalone boot | ready in <1 s, writes `runtime.json`, detects Claude Code 2.1.296 (claude.ai login) and Codex 0.162.1 (ChatGPT login) |
| `electron-vite build` | main / preload (cjs, sandboxed) / renderer built |
| Real Claude Code session via the protocol | workspace from a temp git repo → task PROJ-1 → session: Read tool call, streamed answer, result; task moved to *review*; provider session id persisted |
| Approvals, for real | `Write NOTES.md` → ApprovalRequested (risk medium) → approved from the protocol → file written. `rm NOTES.md` → rejected → tool denied, file intact, agent reported the refusal |
| Resume and cancel | follow-up turns on an idle session reuse the provider session; a running session is cancelled cleanly (status `cancelled`, system entry) |
| Screenshots | `docs/design/screenshots/*.png` captured from the built app with `CODEO_SCREENSHOT_DIR` (compare with `docs/design/references/home-desktop.webp`) |

Not verified in this session: mobile app on a device/simulator (code typechecks; Metro/Expo run not executed), gateway against a real runtime relay client (phase 6), packaged installers.
