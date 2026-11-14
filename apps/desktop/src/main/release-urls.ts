const DOWNLOAD_BASE = 'https://github.com/neocra/codeo/releases/download';

/**
 * The release tag electron-updater's GitHub provider resolved (`GithubUpdateInfo.tag`).
 * Falls back to the bare version, which is how neocra/codeo tags its releases.
 */
export function releaseTagOf(info: { version: string; tag?: unknown }): string {
  return typeof info.tag === 'string' && info.tag.length > 0 ? info.tag : info.version;
}

export function macZipUrl(tag: string, file: string): string {
  return `${DOWNLOAD_BASE}/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}
