 
/**
 * electron-builder afterPack hook: the runtime bundle may carry native packages for several
 * architectures (CODEO_RUNTIME_EXTRA_ARCH); keep only the ones matching the packed app so each
 * installer ships exactly one copy of the Claude Code, Codex and libsql binaries.
 */
const { execFileSync } = require('node:child_process');
const { readdirSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');

const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
const PLATFORM_PATTERN = /(darwin|win32|linux)-(x64|arm64|ia32|armv7l)/;

function macAppPath(context) {
  const app = readdirSync(context.appOutDir).find((f) => f.endsWith('.app'));
  return path.join(context.appOutDir, app);
}

function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(macAppPath(context), 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

/**
 * Ad-hoc signs the macOS bundle. Packing invalidates the signatures Electron ships with, and macOS
 * refuses to open a bundle whose signature no longer matches ("Codeo is damaged"), with no way for
 * the user to allow it. An ad-hoc signature makes the bundle consistent again: Gatekeeper then
 * offers "Open anyway" for this unnotarized app. When a signing identity is configured,
 * electron-builder re-signs the bundle with it right after this hook, replacing the ad-hoc signature.
 */
function adhocSign(context) {
  const app = macAppPath(context);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' });
  console.log(`  • ad-hoc signed  app=${path.basename(app)}`);
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
  if (context.electronPlatformName === 'darwin') adhocSign(context);
};
