// Metro for a pnpm monorepo (`node-linker=hoisted` in the repo .npmrc): watch the whole
// workspace so `@codeo/*` sources (plain .ts, `main: ./src/index.ts`) are bundled from source,
// and resolve modules from the app first, then the hoisted root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Workspace packages are consumed from TypeScript sources; make sure Metro tries them.
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'ts', 'tsx', 'mjs', 'cjs']));

module.exports = config;
