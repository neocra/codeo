# Codeo — guide for coding agents

Codeo is an AI-native development workspace: a developer orchestrates coding agents (Claude Code, Codex)
across Git repositories; agents do the work, the human decides. Desktop (Electron) is the primary
environment, mobile (Expo) is a remote control, the Runtime (Node) executes, the Gateway relays.

## Layout
- `apps/desktop` Electron + React (electron-vite). Renderer ⇄ sandboxed preload ⇄ main ⇄ Runtime (WebSocket).
- `apps/runtime` the execution engine: sessions, approvals, tasks, workspaces, event log. Standalone Node process.
- `apps/gateway` Fastify + WS relay for remote devices (pairing, tokens, scopes).
- `apps/mobile` Expo / React Native "Codeo Remote".
- `packages/domain` entities (zod) + state machines · `packages/contracts` runtime protocol (commands, events)
- `packages/agent-providers/*` official SDK adapters (`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`)
- `packages/database` Drizzle + libsql · `packages/git` safe git CLI wrapper · `packages/remote-client`
- `packages/ui-tokens` design tokens from the official Codeo Motion artifact · `packages/ui-desktop` React components · `packages/ui-mobile` RN components · `packages/i18n` (fr default, en)

## Rules
- Design: only tokens from `@codeo/ui-tokens` (`--mint`, `--bg-200`, `--space-4`…). Never introduce another design system. See `docs/design/`.
- All user-facing strings go through `@codeo/i18n` (keys in `fr.ts` and `en.ts`).
- Internal packages export TypeScript source (`main: ./src/index.ts`); relative imports have no extension.
- Validate at trust boundaries with zod (IPC, WebSocket, provider output). No `any`.
- Never run git/agents in the renderer. Never build shell strings: `execFile` with argument arrays.
- No fake integrations: a provider that is missing is reported as missing.
- Placeholders must be visible (`<Placeholder>` with the phase number) — no dead controls.

## Commands
```bash
pnpm install
pnpm typecheck && pnpm test && pnpm lint
pnpm --filter @codeo/runtime build   # bundles the runtime (dist/main.js) the desktop spawns
pnpm dev:desktop                     # electron-vite dev (runs the runtime build first)
pnpm --filter @codeo/ui-tokens build:css   # regenerate tokens.css after editing tokens
pnpm --filter @codeo/database generate     # drizzle-kit migration after editing schema.ts
```
Progress and limitations: `docs/development/progress.md`.
