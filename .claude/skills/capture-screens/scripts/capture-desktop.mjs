// Drives the built Codeo desktop app (Electron) with playwright-core and saves PNG captures.
// Started by capture-desktop.sh, which installs playwright-core next to a copy of this file.
//
//   node capture-desktop.mjs --app <apps/desktop> --data <throwaway dir> --out <dir>
//        [--screens home,tasks] [--steps <module.mjs>] [--width 1280 --height 860]
//
// --steps: an ES module whose default export is `async ({ win, shot, go }) => {}`:
//   go(screen)      navigate with window.__codeoNavigate (home, tickets, tasks, sessions, review,
//                   workspaces, plugins, settings)
//   shot(name, el?) save <out>/<name>.png, the whole window or only the locator `el`
//   win             the Playwright Page of the main window (click, selectOption, getByText…)
import { _electron } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const k of ['app', 'data', 'out']) if (!args[k]) throw new Error(`--${k} is required`);
const appDir = path.resolve(args.app);
const out = path.resolve(args.out);
mkdirSync(out, { recursive: true });

const exe = path.join(appDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const app = await _electron.launch({ executablePath: exe, args: [appDir], env: { ...process.env, CODEO_DATA_DIR: path.resolve(args.data) } });
const saved = [];
try {
  const win = await app.firstWindow();
  await win.setViewportSize({ width: Number(args.width ?? 1280), height: Number(args.height ?? 860) });
  // The runtime starts and the demo dataset is written on the first boot.
  await win.waitForFunction(() => typeof window.__codeoNavigate === 'function', null, { timeout: 30_000 });
  await win.waitForTimeout(3000);

  const go = async (screen) => {
    await win.evaluate((s) => window.__codeoNavigate(s), screen);
    await win.waitForTimeout(1200);
  };
  const shot = async (name, el) => {
    const file = path.join(out, `${name}.png`);
    await (el ?? win).screenshot({ path: file });
    saved.push(file);
  };

  for (const screen of (args.screens ?? '').split(',').filter(Boolean)) {
    await go(screen);
    await shot(screen);
  }
  if (args.steps) {
    const { default: steps } = await import(pathToFileURL(path.resolve(args.steps)).href);
    await steps({ win, shot, go });
  }
} finally {
  await app.close();
}
console.log(saved.join('\n'));
