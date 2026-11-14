# Progress

_Updated: 2026-11-14_

## Current milestone: Phase 6 — remote access (in progress)

### Demo data for review diffs and pull requests (done and verified)
- The demo dataset (`apps/runtime/src/demo`) now has four reviewed tasks that ran in a worktree: ELY-142 and CC-91 in
  review, ELY-136 and CC-88 completed. Their lanes are fictional `demo://.codeo/worktrees/…` folders on a real
  `codeo/…` branch name, the agent's session works in its lane, and `worktrees.diff` serves their scripted changes
  (`diffs.ts`: C# inventory stacking and cloud saves, TypeScript rate limiting and CSV export) — git is never called.
- Two pull requests: #87 (ELY-136) open with one failed, one running and one passed check, #212 (CC-88) approved.
  The demo runtime never polls GitHub for them (`pullRequests.refresh` is refused in demo, no background watch, so no
  merged-lane cleanup either); opening a PR stays refused.
- Requesting changes on a demo lane works: the scripted agent takes the feedback as its next turn in the lane, goes
  through a real approval and the task returns to review (the worktree check for demo lanes is the row, not git).
- Seed version 2: a demo database written by the first version gets the lanes, their tasks and sessions and the
  pull requests at the next boot; the other tasks keep what was done in the demo.

### Phase 6, step 4: persistent gateway store (done and verified)
- PostgreSQL implementation of `GatewayStore` (`apps/gateway/src/postgres/`: `db.ts` pool + transactions on `pg`,
  `migrations.ts` versioned schema applied at boot under an advisory lock, `store.ts` the five stores). Enabled by
  `DATABASE_URL` (`postgres://…`, password masked in logs, `DATABASE_POOL_SIZE`); required when `NODE_ENV=production`,
  development falls back to the in-memory store with a warning.
- Security decisions are single statements: a pairing code is consumed by `UPDATE … WHERE used_at IS NULL RETURNING`;
  `RefreshTokenStore.markRotated` now returns whether this call retired the token, and a refresh that loses the race is
  treated as a replay (device revoked) — the memory store follows the same rule, so two concurrent refreshes with one
  token could both succeed before.
- Housekeeping every hour (`runMaintenance`): used/expired pairing codes, expired refresh tokens (they were never pruned
  before) and audit entries older than `AUDIT_RETENTION_DAYS` (90). `AuditStore.prune`, `GatewayStore.close` added; the
  relay's fire-and-forget last-seen writes now log a failure instead of raising an unhandled rejection.
- Tests: every gateway test runs twice through vitest projects, on the memory store and on PostgreSQL (PGlite, in
  process — no server needed in CI); a store contract suite (round-trips, single use under concurrency, rotation race,
  prune, audit order/limit/filters) and a restart suite. Runtime e2e: the runtime and a paired phone carry on after the
  gateway process restarts on the same database, without registering or pairing again.

### Phase 6, step 3: runtime identity + Face ID on approvals (done; verified in the iOS simulator except a Face ID match)
- Runtime identity key (Ed25519, `apps/runtime/src/remote/identity.ts`), kept in `settings` (`remoteIdentity`) across
  gateway registrations. `remote.status` and `remote.pairingStart` return its `fingerprint`; the runtime adds the public
  key to the QR payload (`key`) after the gateway built it. Contracts: `identity.ts` (schemas, signed message,
  `formatFingerprint`), command `remote.identity` (`read`, signs a 32-byte challenge).
- `@codeo/remote-client`: `runtimeIdentityCheck` (pure JS, `@noble/curves` + `@noble/hashes`, random bytes from the
  caller), `RuntimeClientOptions.verify` run after every `welcome` before `connected` (events held meanwhile), new
  terminal state `untrusted`. Credentials keep `runtimeKey` + `runtimeKeySource` (`qr` / `first-use`);
  `GatewaySession.pinRuntimeKey` persists after a refresh in flight, and a refresh keeps the pinned key.
- Gateway: device sockets are closed (4004) when the runtime connection closes or is replaced, so phones reconnect and
  prove the runtime again (found in the simulator: a runtime restarted with another key kept the phone's session).
- Mobile: identity check on every gateway connection (`expo-crypto` for randomness), "Runtime non reconnu" state with
  "Jumeler à nouveau", fingerprint + its origin in Plus → Accès distant. Approve and reject ask for Face ID / Touch ID
  (passcode fallback, `expo-local-authentication`); cancelled = nothing sent, the card says so without "error".
- Desktop: fingerprint next to the pairing QR code and in Settings → Remote access.

### Phase 6, step 2: mobile pairing by QR (done and verified in the iOS simulator; camera scan not exercised)
- `@codeo/remote-client` gateway transport (`src/gateway.ts`): `parsePairingQr` (zod, `{v:1, gateway, code, runtimeId,
  nonce}`), `completePairing` (`POST /v1/pairing/complete`, QR or a code typed by hand), `refreshCredentials`
  (`POST /v1/auth/refresh`), `deviceConnectUrl`. HTTPS only, except this machine (`localhost`, `127.0.0.1`, `[::1]`,
  the Android emulator's `10.0.2.2`). Errors are typed (`GatewayClientError.code`, `fatal` for refused/revoked).
- `GatewaySession`: hands out a valid access token, refreshes 60 s before expiry, single-flight (the gateway rotates
  refresh tokens and revokes a phone that presents a retired one), keeps the rotated token in memory and persists it
  before handing out the access token; forced refreshes are limited to one per 30 s.
- `RuntimeClient`: token provider called before each connection (`{ failures, rejected }`), `bearerHeader` sends it as
  `Authorization: Bearer` on the upgrade (React Native's third `WebSocket` argument), close 4003 → immediate token
  renewal, a fatal token error → terminal `unauthorized` state (no reconnect loop), `disconnected` event with the close
  code (4004 = runtime offline behind the gateway).
- `@codeo/shared-utils` exposes `./emitter` and `./deferred`; the client imports them instead of the barrel, whose
  `node:crypto` import broke the React Native bundle (the mobile app did not bundle on `main` before this step).
- Mobile: `expo-camera` scanner screen (`app/pair.tsx`: permission request / denied → phone settings, QR read once,
  manual gateway + 6-digit code), credentials as one JSON item in the keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
  (never in backups), one `GatewaySession` per paired device for the app's life (an effect run twice cannot refresh the
  same token twice). A paired phone connects through the gateway and ignores the direct URL/token. Plus → "Accès
  distant": state, gateway, device, pairing date, pair again, forget (two steps). Empty states offer pairing, explain a
  revoked phone and a computer that is not connected to the gateway.

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
- Demo mode (`CODEO_DEMO=1`, Settings → Mode démo): fictional Elyndor (Unity, multi-repo) and Codeo Cloud
  (SaaS monorepo) workspaces with tasks, transcripts and past approvals (`apps/runtime/src/demo`). Scripted
  agents (`DemoProvider`, reported as `version: demo`, no executable) stream a turn and go through a real
  Codeo approval; nothing is spawned or written. Separation: the desktop runs the demo runtime on
  `~/.codeo/demo` (own database and discovery file); each database records its mode and a runtime refuses
  to open data of the other mode; demo runtimes refuse real repository paths, opening pull requests and turning remote access on (Settings shows a notice instead of the remote card). The UI shows a "Démo" badge
  and a banner whenever `runtime.info.demoMode` is true.

### Known limitations
- Remote access: mobile pairing was run in the iOS simulator with a code typed by hand; the camera scan of the desktop's
  QR code and a physical phone (keychain, network changes) are not verified yet. With `DATABASE_URL` unset (development) the gateway keeps
  registrations in memory, so a restart means turning remote access on again; with PostgreSQL they survive. One gateway
  instance per runtime: rate limiters and the relay are per process. No certificate pinning, no push notifications; the runtime proves its identity at
  connection time but frames are not signed end to end, and Face ID is enforced by the app only. "Forget this pairing" on the phone does not revoke it on the gateway (revoke from the desktop).
- Tickets (Jira/GitHub), Plugins: phase 5/8 — screens exist as labelled placeholders.
- Pull requests: GitHub only (via `gh`, so github.com and GHE hosts `gh` is logged in to); status and checks are polled every 2 minutes (no webhooks); merging is done on GitHub; parallel lanes target the base branch (dependent PRs are linked in their description, not stacked on each other's branch). The remote is always `origin`. Dependencies are only written into the description when a PR is created.
- Worktrees: cleaned up automatically only once their PR is merged (and only when clean); otherwise removal is manual from the task detail. Completing a Best-of-N task records the winner but does not remove the losing candidates' worktrees. Local branches are never deleted.
- Standalone sessions (`sessions.start`, Sessions screen) still run in the repository root.
- Review comments are not persisted as drafts (they live in the screen until sent) and are not posted to GitHub PRs; after completion, iterate with a new task.
- Demo mode: tickets have no demo data yet. Demo repositories are not Git checkouts, so tasks created in demo mode run without worktree isolation (parallel / best-of-N are refused there); only the seeded lanes have diffs, and a change request on them does not change the scripted diff. Demo pull requests are a fixed snapshot (refresh is refused). The demo dataset is written once (and upgraded once per dataset version); delete `~/.codeo/demo` to reset it.
- Codex approvals: the Codex SDK drives `codex exec`, which has no permission callback; sessions rely on Codex's own sandbox (`workspace-write`).
- Packaging: `release.yml` builds unsigned installers for macOS/Windows/Linux on each GitHub release and the app can check/install updates (see `docs/development/releases.md`); macOS self-update needs signing secrets.
- Mascot asset missing from the artifact (see `docs/design/README.md`).

### Next priorities
1. Scan the desktop's QR code from a physical phone (QR pairing pins the runtime key; Face ID match on a real device).
2. Push notifications for approvals (APNs/FCM, content-free payloads) — `docs/security/remote-access.md` §5.

## Verification log — 2026-11-13 (phase 6, persistent gateway store)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | 17/17 clean |
| `pnpm test` | all pass; gateway 84 (39 on the memory store + 45 on PostgreSQL/PGlite; the restart, migration and configuration suites run in the PostgreSQL project only: store contract 7, restart keeps runtimes/phones/tokens/pending codes/audit, concurrent refresh → one 200 + one 401 and the device revoked, migrations idempotent and a newer schema refused, `DATABASE_URL` required in production), runtime 51 (new: runtime + phone survive a gateway restart on the same database) |
| Built gateway (`dist/main.js`) on the `pg` driver over the PostgreSQL wire protocol (`pglite-socket` server, on-disk data) | first boot migrated (`applied: [1]`), runtime registered, phone paired, second code started; gateway killed and restarted → no migration, `/v1/devices` lists the phone, refresh 200, the code started before the restart completes (201), replaying the rotated refresh token revokes the phone; logs show `postgres://postgres:***@…` |

Not verified: a PostgreSQL server (Docker's daemon did not answer in this session, so the wire-protocol run used
PGlite behind `pglite-socket`), several gateway processes on one database.

## Verification log — 2026-11-13 (phase 6, runtime identity + Face ID)

| Check | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | pass |
| `pnpm test` | all pass: remote-client 18 (identity: valid proof, fresh challenge each time, replayed proof, other key, claimed key without its private key, malformed answer, first use, fingerprint = runtime's; pinned key survives a refresh in flight; QR key pinned at pairing), runtime remote e2e 10 (key in the QR code and same fingerprint on both sides, proof on connect, first-use pin, wrong key → `untrusted` and no request possible, proof for another runtime id refused), gateway 32 (a replaced runtime connection closes its devices with 4004) |
| iOS simulator (iPhone 15 Pro, Expo Go SDK 54) + local gateway + runtime on a throwaway dir with a scripted agent | code typed by hand → connected, fingerprint pinned on first use and equal to the runtime's (`Plus → Accès distant`); app relaunched and runtime restarted → reconnects and proves again; Approve and Reject each open the system prompt "Confirmer la décision", cancelling sends nothing (the runtime received no decision) and the card says "Décision annulée : rien n'a été envoyé."; runtime restarted with another identity key → the gateway drops the phone, the phone reconnects and ends in "Runtime non reconnu" with "Jumeler à nouveau". The captures caught three defects, fixed: the fingerprint was truncated in Plus (now on its own line), a cancelled prompt was shown as "Une erreur est survenue.", and the gateway kept the phone's socket open across a runtime restart, so the new runtime was never challenged |

Not verified: a successful Face ID match (the simulator's Face ID enrollment could not be driven from this session; the passcode fallback was shown instead, and the decision path after a confirmed prompt is the same `approvals.resolve` the e2e test covers), QR pairing with the camera, a physical phone.

## Verification log — 2026-11-12 (phase 6, mobile pairing)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (17 packages/apps) | clean |
| `pnpm test` | 154 tests passed, 0 failed (remote-client 8, through a real in-process gateway and a scripted runtime: QR → pairing → device socket with a Bearer header → `runtime.info`, `remote.pairingStart` refused FORBIDDEN; manual code; used / mis-bound codes refused; unreachable gateway retryable; refresh before expiry, single-flight for 3 concurrent callers, forced refresh rate limited; replayed refresh token → fatal; revoked phone ends in `unauthorized` instead of reconnecting) |
| `pnpm lint` | 0 errors |
| `expo export --platform ios` | bundled (1346 modules, Hermes); failed before the `shared-utils` subpath fix with `Unable to resolve module node:crypto` |

| iOS simulator (iPhone 15 Pro, Expo Go SDK 54) + local gateway (8787) + runtime on a throwaway data dir | empty state offers pairing → manual gateway + code → paired, home "Connecté", the runtime lists the device `connected: true` with the 3 remote scopes; app killed and relaunched → reconnects from the keychain; device revoked from the runtime → "Accès révoqué" with "Jumeler à nouveau", no reconnect loop. The captures caught two defects, fixed: the pairing screen's back link said "Plus" when opened from Home (now "Retour"), and "Jumeler à nouveau" was truncated next to "Oublier ce jumelage" (buttons now stacked) |

Not verified in this session: the camera scan of the desktop's QR code (the simulator has no camera), a physical phone.

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

## Verification log — 2026-10-21 (demo mode)

| Check | Result |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | 17/17 clean |
| `pnpm test` | all suites pass; `demo.test.ts` 7 tests (dataset validity, scripted task through a manual-mode approval, resume of a seeded session, new task in auto mode without worktree or approval, demo/live data-mode separation) |
| `CODEO_DEMO=1` standalone runtime bundle | boots, detects `claude-code:demo`, `codex:demo`, `runtime.json` flags `demoMode: true` |
| `electron-vite build` | ok |

Not verified: the Settings toggle and banner in the running Electron app (no interactive session).
