# Codeo Remote (`@codeo/mobile`)

The React Native / Expo companion app for Codeo: see what your agents are doing from your phone,
read their sessions, and — the core mobile job — **approve or refuse** the sensitive operations
they ask for. Phase 1 is the foundation: the design system in React Native (`@codeo/ui-mobile`),
the five tabs, the runtime connection, and the approval inbox wired to real commands.

## Run it

```bash
pnpm install                          # once, at the repo root
pnpm --filter @codeo/runtime dev      # the runtime on your dev machine
pnpm --filter @codeo/mobile start     # Metro + Expo dev tools (or: pnpm dev:mobile)
```

Press `i` for the iOS simulator, `a` for an Android emulator, or scan the QR code with Expo Go
(SDK 54). Typecheck with `pnpm --filter @codeo/mobile typecheck`.

The Metro config watches the whole monorepo so the `@codeo/*` packages are bundled straight from
their TypeScript sources (the repo uses `node-linker=hoisted`, so there is a single `node_modules`
at the root).

## How it connects

The app talks to the Codeo **runtime** over its WebSocket protocol (`@codeo/remote-client` +
`@codeo/contracts`), exactly like the desktop app does.

1. Start the runtime on your dev machine. It writes its discovery file to
   `~/.codeo/runtime.json`:
   ```json
   { "url": "ws://127.0.0.1:52133", "token": "…", "pid": 1234, "version": "0.1.0" }
   ```
2. In the app, open **Plus → Connexion au runtime**, paste the `url` and the `token`, then
   *Enregistrer et connecter*. Both are stored in the device keychain (`expo-secure-store`).
3. The home screen, tasks, sessions and approvals fill in from `home.summary`, `tasks.list`,
   `sessions.list`, `sessions.get` and `approvals.list`; runtime events keep them live
   (`SessionEntryAppended`, `TaskUpdated`, `ApprovalRequested`, …) through the event bridge in
   `lib/runtime.tsx`.

### Reaching the runtime from a phone (development only)

The runtime binds to `127.0.0.1`, so out of the box only the **iOS simulator** (which shares the
Mac's loopback interface) can reach it with the URL from `runtime.json`. For an Android emulator,
replace `127.0.0.1` with `10.0.2.2`. For a physical phone on the same **trusted** network, start the
runtime with

```bash
CODEO_RUNTIME_HOST=0.0.0.0 pnpm --filter @codeo/runtime dev
```

and use your machine's LAN IP in the URL. This is a **development shortcut**: it exposes the runtime
(bearer-token protected, but unencrypted) to the local network. The real remote path is the
**gateway** (phase 6), which the phone pairs with by QR code and which brokers an encrypted
connection to the runtime.

## What is real and what is placeholder

Real, backed by runtime commands:

- **Accueil** — greeting, connected machine, the running session as a hero card (status, progress,
  repos), pending approvals (approve / refuse call `approvals.resolve`), recent sessions.
- **Tâches** — `tasks.list` with the Toutes / Actives / En attente / Terminées filters; a row opens
  the task's latest session.
- **Sessions** — `sessions.list`; a session opens the chat screen (`sessions.get`), live through
  events, with a composer (`sessions.send`) and *Arrêter* (`sessions.cancel`). Tool calls are
  collapsible and their output is truncated.
- **Approbations** — the inbox: `approvals.list({ status: 'pending' })`, with agent, task, summary,
  affected items, risk level, expiry countdown, Approuver / Refuser.
- **Plus** — runtime URL + token (secure store), connection state, `runtime.info`, a local first
  name for the greeting, language fr / en.

Placeholder, clearly labelled in the UI:

- **Accès distant** in *Plus*: QR pairing and the gateway arrive in phase 6/7
  (`settings.remote.placeholder`).

Not in phase 1: push notifications, the review / diff screen, creating tasks from the phone.

## Layout

```
app/                 expo-router routes
  _layout.tsx        fonts, QueryClient, ThemeProvider, RuntimeProvider
  (tabs)/            Accueil · Tâches · Sessions · Approbations · Plus
  session/[id].tsx   chat screen
components/          app-level compositions (Screen, ApprovalInboxCard, SessionRow, …)
lib/
  runtime.tsx        RuntimeClient context, useCommand (TanStack Query), event bridge
  settings.ts        zustand store persisted in expo-secure-store
  presentation.ts    status → pill tone/label, labels, formatting
  i18n.tsx           useT() — @codeo/i18n translator for the current locale
```

Design rules come from `docs/design/design-system.source.md`; every colour, radius, spacing and
text style is a token from `@codeo/ui-tokens` via `@codeo/ui-mobile`'s `useTheme()`.
