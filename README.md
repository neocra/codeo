# Codeo

**AI handles complexity. Humans stay in control.**

Codeo is a next-generation development workspace where you orchestrate AI coding agents (Claude Code,
Codex) across Git repositories, follow their sessions live, approve sensitive operations, review the
result and ship pull requests — from your desktop, or remotely from your phone.

| Component | Stack | Status |
| --- | --- | --- |
| Codeo Desktop (`apps/desktop`) | Electron · React · Vite | Phase 1–3: workspaces, tasks, live sessions, approvals |
| Codeo Runtime (`apps/runtime`) | Node · WebSocket · SQLite (libsql + Drizzle) | Real Claude Code + Codex sessions via official SDKs |
| Codeo Remote (`apps/mobile`) | Expo · React Native | Foundation: screens + runtime client |
| Remote Gateway (`apps/gateway`) | Fastify · WebSocket | Skeleton: pairing, tokens, scoped relay |

## Quick start

```bash
pnpm install
pnpm typecheck && pnpm test
pnpm dev:desktop
```

The desktop app spawns the runtime as a child process (Electron's binary in Node mode), connects over a
loopback WebSocket with a per-launch token, and shows the Home screen. Create a workspace from a local
Git repository, then create a task and start it: a real Claude Code session streams into the Sessions
screen; permission requests appear as approval cards.

Run the runtime on its own (it writes `~/.codeo/runtime.json` with its URL and token):

```bash
pnpm --filter @codeo/runtime start
```

## Documentation
- [Architecture](docs/architecture/overview.md)
- [Design system](docs/design/README.md)
- [Security](docs/security/)
- [Progress & limitations](docs/development/progress.md)
