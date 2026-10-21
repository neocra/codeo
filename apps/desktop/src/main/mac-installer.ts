import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, constants, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { app, net } from 'electron';

const run = promisify(execFile);

/** One entry of `latest-mac.yml` (`updateInfo.files`): file name relative to the release, base64 sha512. */
export interface ReleaseFile {
  url: string;
  sha512: string;
  size?: number;
}

/** A downloaded, verified and unpacked bundle waiting to replace the running one. */
export interface StagedMacUpdate {
  currentApp: string;
  stagedApp: string;
}

/**
 * Squirrel.Mac refuses unsigned bundles, so unsigned macOS builds update themselves here instead:
 * download the release zip, check its sha512 against latest-mac.yml, unpack it with `ditto`
 * (keeps the framework symlinks and the ad-hoc signature), and swap the .app once Codeo has quit.
 */
export class MacSelfInstaller {
  /** The running bundle, or null when it cannot be replaced in place (translocated, read-only). */
  async replaceableBundle(): Promise<string | null> {
    const bundle = resolve(app.getPath('exe'), '..', '..', '..');
    if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return null;
    try {
      await access(dirname(bundle), constants.W_OK);
      await access(bundle, constants.W_OK);
      return bundle;
    } catch {
      return null;
    }
  }

  /** The zip built for this architecture (`Codeo-<v>-mac-<arch>.zip`). */
  pickZip(files: readonly ReleaseFile[]): ReleaseFile | null {
    return files.find((f) => f.url.endsWith(`-${process.arch}.zip`)) ?? null;
  }

  async stage(downloadUrl: string, file: ReleaseFile, currentApp: string, onProgress: (percent: number) => void): Promise<StagedMacUpdate> {
    const workDir = await mkdtemp(join(tmpdir(), 'codeo-update-'));
    try {
      const zipPath = join(workDir, 'update.zip');
      await this.download(downloadUrl, zipPath, file, onProgress);
      const unpacked = join(workDir, 'app');
      await mkdir(unpacked);
      await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked]);
      const bundleName = (await readdir(unpacked)).find((name) => name.endsWith('.app'));
      if (!bundleName) throw new Error('The update archive contains no .app bundle.');
      const stagedApp = join(unpacked, bundleName);
      /* Downloads made by Codeo itself are not quarantined, but clear the flag in case a parent folder carried it. */
      await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', stagedApp]).catch(() => undefined);
      await rm(zipPath, { force: true });
      return { currentApp, stagedApp };
    } catch (err) {
      await rm(workDir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Hands the swap to a detached shell that outlives Codeo: wait for this process to exit, move the
   * old bundle aside, move the new one in (restoring the old one on failure), then optionally relaunch.
   * The script is a constant; paths travel as positional arguments.
   */
  scheduleSwap(update: StagedMacUpdate, relaunch: boolean): void {
    const script = [
      'import os, shutil, subprocess, sys, time',
      'pid = int(sys.argv[1])',
      'current = sys.argv[2]',
      'staged = sys.argv[3]',
      'relaunch = sys.argv[4] == "1"',
      'old = current + ".codeo-old"',
      'while True:',
      '    try:',
      '        os.kill(pid, 0)',
      '    except ProcessLookupError:',
      '        break',
      '    except PermissionError:',
      '        break',
      '    time.sleep(0.2)',
      'shutil.rmtree(old, ignore_errors=True)',
      'swapped = False',
      'try:',
      '    os.rename(current, old)',
      '    os.rename(staged, current)',
      '    shutil.rmtree(old, ignore_errors=True)',
      '    swapped = True',
      'except Exception:',
      '    if (not os.path.isdir(current)) and os.path.isdir(old):',
      '        try:',
      '            os.rename(old, current)',
      '        except Exception:',
      '            pass',
      'staging_root = os.path.dirname(os.path.dirname(staged))',
      'shutil.rmtree(staging_root, ignore_errors=True)',
      'if relaunch and swapped:',
      '    subprocess.Popen(["/usr/bin/open", current], close_fds=True)',
    ].join('\n');
    const child = spawn('/usr/bin/python3', ['-c', script, String(process.pid), update.currentApp, update.stagedApp, relaunch ? '1' : '0'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  private async download(url: string, target: string, file: ReleaseFile, onProgress: (percent: number) => void): Promise<void> {
    const res = await net.fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
    const total = Number(res.headers.get('content-length')) || file.size || 0;
    const hash = createHash('sha512');
    let received = 0;
    let lastPercent = -1;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        received += chunk.length;
        const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
        if (percent !== lastPercent) {
          lastPercent = percent;
          onProgress(percent);
        }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(target));
    if (hash.digest('base64') !== file.sha512) throw new Error(`Checksum mismatch for ${file.url}`);
  }
}
