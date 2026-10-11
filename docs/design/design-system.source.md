Codeo Motion is the interface language of Codeo, the workspace where you hand tickets to coding agents (Claude Code, Codex), watch them work, and review what they ship. You live in it all day, so it has two jobs at once: **feel alive** — you should sense at a glance what is running, what is waiting and what needs you — and **stay out of the way** while you read code. The rule that reconciles them: *alive at the edges, still at the centre.*

## Principles

1. **Motion is state.** Every animation reports something that changed: an agent started, a check went green, a PR needs approval. If nothing changed, nothing moves.
2. **Alive at the edges, still at the centre.** Ambient loops live in status pills, avatars, progress bars and the sidebar. Code, diffs, the terminal and chat text never move while you read; new content arrives once, then holds still.
3. **Colour is meaning, never decoration.** `mint` = alive / yours / good, `amber` = needs you, `sky` = queued, `coral` = broken. A colour that means nothing stays grey.
4. **The spring is your reward.** `ease-spring` is reserved for actions *you* take (Approuver, Créer une tâche, send). The system's own changes use `ease-standard` and `ease-enter`.
5. **One loop per region, and it can be silenced.** Never two ambient loops side by side in the same card. Everything ambient stops under `prefers-reduced-motion` and under `data-motion="calm"` on any ancestor — wire that to a "Mode focus" toggle.

## Content

- The product speaks French, in the second person plural to the user ("Voici ce qui demande votre attention") and as a colleague in agent messages ("J'ai implémenté…").
- Sentence case everywhere. Buttons are a verb first: "Reprendre la session", "Approuver", "Voir les détails", "Demander des modifications".
- Times are relative and short: "il y a 1 h 24", "Hier à 16:42". Counts are digits, set in `code-sm` with tabular numerals: `+124 −12`, `24/24`.
- Ticket keys (`PROJ-123`), PR numbers (`#428`), repo names (`atlas-unity`) and branch names are always mono.
- No emoji in the UI. The one exception is the greeting's wave, which the product already uses ("Bonjour Aurélien 👋") — keep it there only.

## Colour

- Default to the **Dark** theme; **Light** is for daylight and screen-sharing and has the same roles.
- Stack surfaces by elevation: `bg-000` page and code canvas → `bg-100` chrome (sidebar, top bar) → `bg-200` cards → `bg-300` inputs, chips, hover → `bg-400` selected / active.
- Text is `ink`, then `ink-muted` for metadata, then `ink-faint` for line numbers and tertiary labels (never on `bg-400`).
- Outline controls with `line-strong` (3:1). `line` is only for hairlines between rows and around cards.
- Fill only the primary action of a view with `mint` and label it in `on-mint`. Fill the approve action with `amber` and `on-amber`. Never put white text on mint or amber in dark.
- Status = a soft ground + the strong colour as text + a dot: `mint-soft`/`mint` (Session active, En cours, CI ok), `amber-soft`/`amber` (À relire, En revue, approvals), `sky-soft`/`sky` (En attente, Planifiée), `coral-soft`/`coral` (Échec), `bg-300`/`ink-muted` (Terminé, Backlog). Each pill always carries its word — colour is never the only signal.
- Diffs: added lines on `diff-add`, removed on `diff-del`, the `+`/`−` gutter in `mint`/`coral`. Syntax uses `syn-keyword`, `syn-string`, `syn-type`, `syn-fn`, `syn-comment`, `syn-number`.
- Light comes from what is alive: use `glow-mint` on the running session and the primary button's hover, `glow-amber` only at the peak of the approval breathe. Use `shadow-lg` for anything floating.

## Type

- Set the interface in Geist (`--font-sans`) and all code, keys, counts and durations in JetBrains Mono (`--font-mono`). Both are hosted on Google Fonts; `components/bundle.css` imports them.
- One `display` per screen (the greeting or page title). The current task's name is `title`. Card headings are `heading`; rows use `body` + `body-sm`; pills, chips and compact buttons use `label`; kickers ("ACTIVITÉ EN COURS") use `overline` in capitals.
- Use `font-variant-numeric: tabular-nums` on anything that ticks (timers, percentages, counts) so numbers don't jitter as they change.

## Space, radius, layout

- 4px grid: `space-3` inside rows and buttons, `space-5` inside cards (`space-4` when compact), `space-6` between cards, `space-8` page gutter on desktop.
- Corners: `radius-xs` chips, `radius-sm` buttons / inputs / nav items, `radius-md` cards, `radius-lg` the hero task card and mobile sheets, `radius-full` pills, dots and progress tracks.
- Desktop: a 240px sidebar on `bg-100`, content on `bg-000`, cards on `bg-200` with a `line` border. Mobile: a bottom tab bar on `bg-100` with the same five destinations (Accueil, Tickets, Tâches, Sessions, Revue).

## Motion

The full choreography is in the **Motion** section. In short: transitions use the `duration` and `easing` tokens (`--dur-*`, `--ease-*`) and travel `shift-*` distances — never raw milliseconds or curves. UI feedback stays under `dur-base` (220ms); only living things loop, at `dur-ambient`.

## States

- Hover: background moves one step up (`bg-200` → `bg-300`) in `dur-instant`. Arrows and chevrons nudge `shift-1` to the right.
- Press: scale to 0.97 in `dur-quick`, release on `ease-spring`.
- Focus: the `focus-ring` shadow, shown instantly, never animated.
- Disabled: 45% opacity, no hover, no motion.
- Loading: the button keeps its width and swaps its icon for the orbiting arc; the label stays.

## Iconography

- Line icons on a 24px grid, 1.75px stroke, round caps and joins, drawn in `currentColor` at 16px (20px in the nav). The components carry their own small set (home, ticket, tasks, session, review, branch, check, play, plus, shield, file, chevron) in the Lucide style the screens use; for anything else, use Lucide at the same stroke.
- Agents are shown as a round avatar with their initial ("C"), never as a logo. The robot mascot on the home screen is an illustration, not an icon — keep it to the greeting card.

## Using the components

Components are in `components/bundle.js` as `window.Codeo` and need React 18 on the page. Load `tokens.css`, then `components/bundle.css`, then the bundle. Every component animates through the motion tokens and respects `prefers-reduced-motion` and `data-motion="calm"`.
