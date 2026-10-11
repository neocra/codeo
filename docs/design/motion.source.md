# Motion

Motion in Codeo answers one question: **what changed, and does it need me?** The louder the motion, the more it needs you. Use the ladder below, pick the lowest rung that is true, and never skip up.

## The attention ladder

| Rung | Means | Motion | Tokens | Example |
| --- | --- | --- | --- | --- |
| 0 · Still | Nothing is happening | none | — | A finished session row, a diff you are reading |
| 1 · Ambient | Something is alive, you don't need to act | a slow loop, small and peripheral | `dur-ambient`, `ease-breathe` | The pulsing ring of "Session active", the orbit around a working agent's avatar |
| 2 · Progress | Work is advancing | a flowing stripe, a fill that moves forward | `dur-shimmer`, `ease-linear`; fill steps `dur-slow` `ease-standard` | The task progress bar while Claude Code implements |
| 3 · Arrival | Something new just appeared | a single enter, then still | `dur-base`, `ease-enter`, `shift-3`, `stagger-step` | New checklist items in an agent message, new diff hunks, new rows |
| 4 · Nudge | It needs you, soon | one sweep plus three breaths, then still | `dur-shimmer` once, then `dur-ambient` ×3, `glow-amber` | An approval card appearing |
| 5 · Reward | You did something | a spring and a drawn check | `dur-deliberate`, `ease-spring` | Approuver → the card turns mint and a check pops |

Nothing in Codeo loops forever *and* demands action. A nudge plays three times and stops; the amber colour carries the rest.

## Choreography rules

- **Enter with `ease-enter`, leave with `ease-exit`, move with `ease-standard`.** Exits are faster than entrances: enter at `dur-base`, exit at `dur-quick`.
- **Move short.** Rows and messages rise `shift-3` (8px), pills `shift-2`, panels `shift-4`. Never slide content across the screen.
- **Stagger siblings** by `stagger-step` (45ms), capped at 8 — the ninth item and beyond arrive with the eighth.
- **Indicators travel, content cross-fades.** The active tab pill and the nav rail slide to their new place (`dur-base`, `ease-standard`); the panel underneath fades, it does not slide.
- **Numbers tick, they don't jump.** A progress bar's width transitions over `dur-slow`; percentages use tabular numerals.
- **Stream text in place.** Agent replies reveal item by item with a blinking caret (steps, 1s) at the end while streaming; the caret disappears when done.
- **Code holds still.** Diffs and code never animate after arrival; a new hunk flashes its background once (`dur-deliberate`) from the glow colour to `diff-add` / `diff-del`.
- **Focus rings never animate.** They appear instantly.

## Calm and reduced motion

- Under `prefers-reduced-motion: reduce`, loops stop (dots stay solid, stripes stay still), enters become plain fades at `dur-quick`, the spring becomes `ease-standard`.
- Setting `data-motion="calm"` on `<html>` (or any container) stops rungs 1, 2 and 4 but keeps arrivals and rewards. Offer it as "Mode focus" — for deep debugging sessions.
- Ambient loops should also pause when the tab is hidden (`document.visibilityState`), to spare the battery.

## Recipes

```css
/* a row entering, with a stagger index i */
.row { animation: cd-enter var(--dur-base) var(--ease-enter) both; animation-delay: calc(var(--i) * var(--stagger-step)); }
@keyframes cd-enter { from { opacity: 0; transform: translateY(var(--shift-3)); } }

/* hover / press on anything clickable */
.clickable { transition: background-color var(--dur-instant) var(--ease-standard), transform var(--dur-quick) var(--ease-spring); }
.clickable:active { transform: scale(.97); }
```
