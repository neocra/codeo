import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

const SCREENS = ['home', 'tickets', 'tasks', 'sessions', 'review', 'workspaces', 'plugins', 'settings'] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Scrolls the page content to its end; resolves true when it was taller than the window. */
const SCROLL_TO_END = `(() => {
  const el = document.querySelector('.cd-content');
  if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
  el.scrollTop = el.scrollHeight;
  return true;
})()`;

/**
 * Captures each screen as PNG for visual comparison against the official design references, plus
 * `<screen>-end.png` scrolled to the bottom when the screen is taller than the window.
 * Only active when CODEO_SCREENSHOT_DIR is set; the renderer exposes `window.__codeoNavigate` for it.
 */
export async function captureScreens(win: BrowserWindow, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await sleep(2500);
  for (const screen of SCREENS) {
    await win.webContents.executeJavaScript(`window.__codeoNavigate && window.__codeoNavigate(${JSON.stringify(screen)})`);
    await sleep(1400);
    const image = await win.webContents.capturePage();
    writeFileSync(path.join(dir, `${screen}.png`), image.toPNG());
    if (await win.webContents.executeJavaScript(SCROLL_TO_END)) {
      await sleep(400);
      writeFileSync(path.join(dir, `${screen}-end.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
}
