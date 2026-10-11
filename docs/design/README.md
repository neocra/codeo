# Codeo design system

The official reference is the Claude Design artifact **Codeo Motion**
(https://claude.ai/artifact/MuUDkMX5ZH465VxfSrJrEr). Its source files are copied here for traceability:

- `tokens.source.json` — the artifact's `project/tokens.json` (colours in dark/light, type, spacing,
  radii, shadows, durations, easings, travel).
- `design-system.source.md` — the artifact's brand book (principles, content rules, colour/type/space usage).
- `motion.source.md` — the attention ladder and choreography rules.
- `references/*.webp` — screen references supplied with the brief (desktop Home, overview boards,
  mobile screens).

## Where it lives in code

| Artifact | Code |
| --- | --- |
| `tokens.json` | `packages/ui-tokens/src/*.ts` (typed), `packages/ui-tokens/src/tokens.css` (generated, checked by a test) |
| `components/bundle.css` | `packages/ui-desktop/src/styles/components.css` (verbatim, class names `cd-*`) |
| `components/bundle.js` (11 React 18 components) | `packages/ui-desktop/src/components/*.tsx` (TypeScript port, same markup/classes) |
| Screens layout (sidebar 240px on `bg-100`, cards on `bg-200`, hero task card `radius-lg`) | `packages/ui-desktop/src/styles/app.css` + `packages/ui-desktop/src/layout/*` |
| Mobile (bottom tab bar on `bg-100`, same five destinations) | `packages/ui-mobile` + `apps/mobile` |

Fonts: Geist and JetBrains Mono, self-hosted through `@fontsource-variable/*` on desktop and
`@expo-google-fonts/*` on mobile (the artifact loads them from Google Fonts; a desktop app must work offline).

## Validation

- `packages/ui-tokens/test` asserts `tokens.css` matches the generator and every role has both themes.
- `packages/ui-desktop/test` renders the components (jsdom) and checks classes, states and callbacks.
- Visual checks are done by running the desktop app and comparing with `references/home-desktop.webp`
  (see `docs/development/progress.md` for the current state of each screen).

## Known gaps

- **Mascot**: the artifact has no asset group, so the robot illustration visible on the reference
  screenshots is not available as a file. Per the brief it must not be redrawn; the greeting card leaves
  the slot empty until the original asset is supplied.
- Light theme values come from the artifact and are wired (`data-theme="light"`), but the screens were
  designed dark-first; light needs a visual pass.
