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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
console.log(`[prepare-runtime] ready at ${out}`);
