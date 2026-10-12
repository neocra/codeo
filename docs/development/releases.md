# Releases and updates

## Cutting a release

1. Create a GitHub release on `neocra/codeo` with a semver tag, e.g. `v0.2.0` (the tag is the
   source of truth: the workflow writes it into `apps/desktop/package.json` before building).
2. `.github/workflows/release.yml` runs on `release: published` (or by hand with
   *Run workflow* and an existing tag). One job per platform:

| Runner | Artifacts uploaded to the release |
| --- | --- |
| macOS | `Codeo-<v>-mac-arm64.dmg`, `Codeo-<v>-mac-x64.dmg`, the matching `.zip` files, `latest-mac.yml` |
| Windows | `Codeo-<v>-win-x64.exe` (NSIS), `.blockmap`, `latest.yml` |
| Linux | `Codeo-<v>-linux-x64.AppImage`, `.deb`, `latest-linux.yml` |

Each job runs `pnpm --filter @codeo/desktop package:<os>`:

- `scripts/prepare-runtime.mjs` builds the runtime (tsup) and installs its published
  dependencies into `apps/desktop/runtime-bundle/` with plain npm, so the packaged runtime does not
  depend on the monorepo's pnpm layout. electron-builder ships that folder as
  `Resources/runtime`, where the desktop main process spawns `main.js`.
- `electron-vite build` bundles main, preload and renderer (every workspace package, `zod`); only the
  production dependencies `electron-updater` and `ws` are shipped from `node_modules`.
- On macOS the bundle also receives the x64 native packages (`CODEO_RUNTIME_EXTRA_ARCH=x64,arm64`,
  fetched with `npm pack`), and electron-builder ships only the matching `*-darwin-<arch>*` packages in
  each app.
- `electron-builder --publish never` produces the installers and the `latest*.yml` manifests;
  `gh release upload … --clobber` attaches them to the release.

The installers embed the Claude Code and Codex native CLIs (≈300 MB), which is why they are large.

## In-app updates

Settings → *Mises à jour* → **Vérifier les mises à jour** asks electron-updater for the newest
release of `neocra/codeo` (`publish` block in `electron-builder.yml`). When a newer version exists
the button **Installer et redémarrer** downloads it and restarts into it. Nothing is downloaded
without that click; `autoInstallOnAppQuit` applies a downloaded update at quit.

- Windows (NSIS) and Linux (AppImage) self-update without signing.
- **macOS requires a signed app** for self-update (Squirrel.Mac rejects unsigned bundles). Without
  `CSC_LINK` / `CSC_KEY_PASSWORD` secrets the workflow produces builds that are only **ad-hoc
  signed** (`scripts/after-pack.cjs`): they open, but Gatekeeper asks the user to allow the app
  once (*System Settings → Privacy & Security → Open Anyway* after the first blocked launch), and
  the app reports the *manual* update state and offers the download page instead. Add the
  Developer ID certificate as secrets (and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID` plus `notarize: true` in `electron-builder.yml`) to enable automatic updates on
  macOS.
  - Builds published before the ad-hoc signature (0.1.1) are reported as *damaged* by macOS. They
    can be repaired by hand after copying the app to `/Applications`:
    `xattr -dr com.apple.quarantine /Applications/Codeo.app && codesign --force --deep --sign - /Applications/Codeo.app`.
- In development (`app.isPackaged === false`) the check reports *unsupported*.
- `.deb` installs are updated through the package, not electron-updater.

## Local packaging

```bash
pnpm --filter @codeo/desktop package:mac      # or package:win / package:linux
ls apps/desktop/release
```
