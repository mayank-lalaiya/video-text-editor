import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resources = join(root, 'resources/media-tools/darwin-arm64');
const archive = join(resources, 'ffmpeg-9.0.2.tar.xz');
const sourceHash =
  '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(
    'Media tools must currently be built on an Apple-silicon Mac.',
  );
}
if (
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex') !== sourceHash
) {
  throw new Error(
    'FFmpeg source archive is missing or does not match its pin.',
  );
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: '15.0' },
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand();
      else reject(new Error(`${command} failed (${signal ?? code}).`));
    });
  });
}

const buildDirectory = await mkdtemp(join(tmpdir(), 'video-editor-ffmpeg-'));
try {
  await run('tar', ['-xJf', archive, '-C', buildDirectory], root);
  const source = join(buildDirectory, 'ffmpeg-9.0.2');
  await run(
    './configure',
    [
      '--disable-autodetect',
      '--disable-network',
      '--disable-debug',
      '--disable-doc',
      '--disable-ffplay',
      '--enable-videotoolbox',
      '--enable-audiotoolbox',
      '--enable-zlib',
      '--extra-version=video-text-editor-m2',
    ],
    source,
  );
  await run('make', ['-j', '8'], source);
  await mkdir(resources, { recursive: true });
  for (const name of ['ffmpeg', 'ffprobe']) {
    await copyFile(join(source, name), join(resources, name));
    await chmod(join(resources, name), 0o755);
  }
  for (const name of ['COPYING.LGPLv2.1', 'LICENSE.md']) {
    await copyFile(join(source, name), join(resources, name));
  }
  console.log('Built local-only LGPL FFmpeg/ffprobe for macOS 15+ arm64.');
} finally {
  await rm(buildDirectory, { recursive: true });
}
