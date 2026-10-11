 
/**
 * electron-builder afterPack hook: the runtime bundle may carry native packages for several
 * architectures (CODEO_RUNTIME_EXTRA_ARCH); keep only the ones matching the packed app so each
 * installer ships exactly one copy of the Claude Code, Codex and libsql binaries.
 */
const { readdirSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
const PLATFORM_PATTERN = /(darwin|win32|linux)-(x64|arm64|ia32|armv7l)/;

function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const app = readdirSync(context.appOutDir).find((f) => f.endsWith('.app'));
    return path.join(context.appOutDir, app, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

function prune(dir, platform, arch, removed) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const m = entry.name.match(PLATFORM_PATTERN);
    if (m) {
      if (m[1] !== platform || m[2] !== arch) {
        rmSync(full, { recursive: true, force: true });
        removed.push(entry.name);
      }
      continue;
    }
    if (entry.name.startsWith('@')) prune(full, platform, arch, removed);
  }
}

module.exports = async function afterPack(context) {
  const arch = ARCH_NAMES[context.arch] ?? String(context.arch);
  const nm = path.join(resourcesDir(context), 'runtime', 'node_modules');
  try {
    statSync(nm);
  } catch {
    throw new Error(`afterPack: runtime node_modules missing at ${nm} (run scripts/prepare-runtime.mjs first)`);
  }
  const removed = [];
  prune(nm, context.electronPlatformName, arch, removed);
  console.log(`  • runtime native packages  platform=${context.electronPlatformName} arch=${arch} removed=[${removed.join(', ')}]`);
};
