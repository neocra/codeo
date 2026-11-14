import { describe, expect, it } from 'vitest';
import { macZipUrl, releaseTagOf } from './release-urls';

describe('release URLs', () => {
  it('uses the tag electron-updater resolved, not a guessed v-prefix', () => {
    expect(releaseTagOf({ version: '0.4.0', tag: '0.4.0' })).toBe('0.4.0');
    expect(releaseTagOf({ version: '0.4.0', tag: 'v0.4.0' })).toBe('v0.4.0');
  });

  it('falls back to the bare version when no tag is provided', () => {
    expect(releaseTagOf({ version: '0.4.0' })).toBe('0.4.0');
    expect(releaseTagOf({ version: '0.4.0', tag: '' })).toBe('0.4.0');
  });

  it('builds the download URL of the published asset', () => {
    expect(macZipUrl('0.4.0', 'Codeo-0.4.0-mac-arm64.zip')).toBe(
      'https://github.com/neocra/codeo/releases/download/0.4.0/Codeo-0.4.0-mac-arm64.zip',
    );
  });
});
