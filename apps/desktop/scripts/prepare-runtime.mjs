#!/usr/bin/env node
/**
 * Builds a self-contained copy of the Codeo Runtime for packaging:
 *   apps/desktop/runtime-bundle/{main.js, migrations/, package.json, node_modules/}
 * The runtime bundle (tsup) keeps its published dependencies external (native SDK binaries,
 * libsql, ws…), so they are installed here with plain npm into a flat node_modules that does
 * not depend on the monorepo's pnpm layout. electron-builder copies the folder to
 * `Contents/Resources/runtime`, where the desktop main process spawns `main.js`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const runtimeDir = path.resolve(desktopDir, '../runtime');
const out = path.join(desktopDir, 'runtime-bundle');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('[prepare-runtime] building @codeo/runtime');
execFileSync(pnpm, ['--filter', '@codeo/runtime', 'build'], { stdio: 'inherit', cwd: path.resolve(desktopDir, '../..'), shell: process.platform === 'win32' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(runtimeDir, 'dist', 'main.js'), path.join(out, 'main.js'));
if (existsSync(path.join(runtimeDir, 'dist', 'main.js.map'))) cpSync(path.join(runtimeDir, 'dist', 'main.js.map'), path.join(out, 'main.js.map'));
cpSync(path.join(runtimeDir, 'dist', 'migrations'), path.join(out, 'migrations'), { recursive: true });

/* Only the published (non-workspace) dependencies: the workspace packages are already bundled in main.js. */
const runtimePkg = JSON.parse(readFileSync(path.join(runtimeDir, 'package.json'), 'utf8'));
const dependencies = Object.fromEntries(Object.entries(runtimePkg.dependencies).filter(([, v]) => !String(v).startsWith('workspace:')));
writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify({ name: 'codeo-runtime-bundle', private: true, type: 'module', version: runtimePkg.version, dependencies }, null, 2),
);

console.log('[prepare-runtime] installing runtime dependencies', Object.keys(dependencies).join(', '));
execFileSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { stdio: 'inherit', cwd: out, shell: process.platform === 'win32' });
/**
 * Cross-architecture native packages. `npm install` keeps only the optional packages matching the
 * runner's CPU, but the macOS release job builds arm64 and x64 apps from this one bundle. For each
 * architecture listed in CODEO_RUNTIME_EXTRA_ARCH, the sibling platform packages (same optionalDependencies
 * map, arch swapped) are fetched with `npm pack` — which does no platform filtering — and unpacked in place.
 * electron-builder then ships only the matching `*-${os}-${arch}*` folders in each app (see electron-builder.yml).
 */
const extraArches = (process.env.CODEO_RUNTIME_EXTRA_ARCH ?? '').split(',').map((a) => a.trim()).filter((a) => a && a !== process.arch);
if (extraArches.length) {
  const nm = path.join(out, 'node_modules');
  const specs = new Map();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('@')) {
        visit(full);
        continue;
      }
      const pkgFile = path.join(full, 'package.json');
      if (!existsSync(pkgFile)) continue;
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
      for (const [name, spec] of Object.entries(pkg.optionalDependencies ?? {})) {
        for (const arch of extraArches) {
          if (name.includes(`${process.platform}-${arch}`) && !existsSync(path.join(nm, name))) specs.set(name, spec);
        }
      }
      if (existsSync(path.join(full, 'node_modules'))) visit(path.join(full, 'node_modules'));
    }
  };
  visit(nm);
  const packDir = path.join(out, '.pack');
  mkdirSync(packDir, { recursive: true });
  for (const [name, spec] of specs) {
    const target = String(spec).startsWith('npm:') ? String(spec).slice(4) : `${name}@${spec}`;
    console.log(`[prepare-runtime] adding ${name} (${target})`);
    const tarball = execFileSync(npm, ['pack', target, '--pack-destination', packDir, '--loglevel=error'], { cwd: out, shell: process.platform === 'win32' }).toString().trim().split('\n').pop();
    const extractDir = path.join(packDir, 'x');
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(packDir, tarball), '-C', extractDir]);
    const dest = path.join(nm, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(path.join(extractDir, 'package'), dest);
  }
  rmSync(packDir, { recursive: true, force: true });
  console.log(`[prepare-runtime] added ${specs.size} package(s) for ${extraArches.join(', ')}`);
}
console.log(`[prepare-runtime] ready at ${out}`);
