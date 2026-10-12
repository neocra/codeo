#!/usr/bin/env node
/** Writes the release tag (v1.2.3 → 1.2.3) into apps/desktop/package.json so builds and the updater agree on the version. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2];
if (!tag) {
  console.error('usage: set-version.mjs <tag>');
  process.exit(1);
}
const version = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`tag "${tag}" is not a semver version`);
  process.exit(1);
}
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(file, 'utf8'));
pkg.version = version;
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`apps/desktop version set to ${version}`);
