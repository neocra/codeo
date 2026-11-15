---
name: capture-screens
description: Capture screenshots of the Codeo apps — the desktop app (Electron) and Codeo Remote (Expo, iOS simulator) — on demo data, for a PR's proof, a design check or docs. Covers whole screens, an open dialog or a state reached by clicking, before/after pairs, and the privacy rules for what may appear in a capture. Use whenever a change touches something a person sees (components, screens, styles, copy in `@codeo/i18n`), when asked to "capture", "screenshot", "show me the screen", "prouve-le avec une capture", "capture d'écran de l'app", or before opening a PR on a UI change.
---

# Capture Codeo screens

Every capture comes from the **real app running on demo data** in a throwaway data directory, never
from `~/.codeo` and never from a mock-up. Look at every capture before using it: a capture is also the
last check that the change works (truncated text, a wrapped row, an untranslated key).

## Desktop (Electron)

`scripts/capture-desktop.sh` does the whole setup and then drives the built app with playwright-core:
- installs dependencies if missing, and downloads the Electron binary (pnpm skips Electron's download script);
- builds the runtime and the desktop app (`--no-build` to skip when nothing changed since the last build);
- installs playwright-core in a temp tools directory, without touching `package.json` or the lockfile;
- starts the app in **demo mode** on a fresh data directory, under the neutral name `Alex`;
- saves one PNG per capture and prints their paths.

```bash
S=.claude/skills/capture-screens/scripts
# whole screens: home, tickets, tasks, sessions, review, workspaces, plugins, settings
$S/capture-desktop.sh --out <scratchpad>/shots --screens home,tasks
# a dialog or any state reached by clicking: a steps module
$S/capture-desktop.sh --out <scratchpad>/shots --steps $S/examples/create-task-auto.mjs
```

A steps module default-exports `async ({ win, shot, go }) => {}`:
- `go(screen)` navigates through `window.__codeoNavigate`;
- `win` is the Playwright `Page`: use `getByRole`, `getByText`, `selectOption`, `click`;
- `shot(name)` captures the window, and `shot(name, locator)` captures only that element (e.g. `[role=dialog]`).

Copy `examples/create-task-auto.mjs` into the scratchpad and adapt it. Don't commit one-off steps modules.

Options: `--width`/`--height` (default 1280×860), `CODEO_USER_NAME` to change the greeting name.
The UI is in French (the default locale). For English, switch the language in Réglages inside the
steps module before capturing.

For a quick look at every screen there is also the built-in harness: build, then launch the app with
`CODEO_SCREENSHOT_DIR=<dir>` (and `CODEO_DATA_DIR` + `CODEO_USER_NAME` as above). It captures all eight
screens, plus `-end` images for pages taller than the window, then quits. Those are the reference
captures in `docs/design/screenshots/`.

## Mobile (Codeo Remote, iOS simulator)

1. Runtime on throwaway demo data: `CODEO_DATA_DIR=$(mktemp -d) CODEO_DEMO=1 node apps/runtime/dist/main.js`
   (after `pnpm --filter @codeo/runtime build`). Its `runtime.json` in that directory gives the `url` and `token`.
2. `pnpm --filter @codeo/mobile start`, then `i` (Expo Go SDK 54 in the iOS simulator).
3. In the app: **Plus → Connexion au runtime**, paste the url and token, then *Enregistrer et connecter*.
   To capture the pairing flow, also run the gateway (`pnpm --filter @codeo/gateway dev`, port 8787)
   and pair with the manual code.
4. Capture with the iOS simulator tool (`screenshot` action) or `xcrun simctl io booted screenshot <file>.png`.
   For a flow, record with `xcrun simctl io booted recordVideo <file>.mov` (≤ 30 s), then make a GIF with
   `ffmpeg -i in.mov -vf "fps=12,scale=600:-1:flags=lanczos" -loop 0 out.gif`.

The simulator has no camera (QR scan), no Face ID match and no push in Expo Go: say so in the proof
instead of faking it.

## Privacy

`neocra/codeo` PR bodies are visible to every reader of the repository. A capture must not show:
- a real name (the scripts set `CODEO_USER_NAME`);
- home paths, hostnames, emails or tokens (the runtime URL and token stay out of the frame);
- the user's own repositories or sessions. Demo mode keeps those in a separate database.

Crop or redact anything else before publishing.

## Using the captures

- Keep the PNGs in the session scratchpad, never in the repo. The exception is a deliberate update of
  `docs/design/screenshots/`.
- For a visual change, capture before (on `main`) and after (on the branch) with the same steps module.
- In a PR: reference each image in the body (`![alt](./shot.png)`) and attach it with `gh pr create|edit --attach ./shot.png`.
  If a capture caught a defect that you fixed, say so in the PR.
