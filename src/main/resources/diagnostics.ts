import { execFile } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { access, open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FONT_FACES } from '../../shared/fonts.ts';
import type { ResourceCheck } from '../../shared/contracts.ts';
import { readManifest, type ResourceEntry } from './manifest.ts';
import { mediaPlatform, type MediaPlatform } from '../platform.ts';

const runFile = promisify(execFile);

export function validateToolBuild(
  id: string,
  version: string,
  target: MediaPlatform = mediaPlatform(),
): void {
  if (id === 'media-guardian') {
    if (version.trim() !== 'media-guardian version 1-video-text-editor')
      throw new Error('The bundled worker guardian is not the pinned build.');
    return;
  }
  const suffix = target === 'win32-x64' ? 'win1' : 'm2';
  if (!version.startsWith(`${id} version 9.0.2-video-text-editor-${suffix}`)) {
    throw new Error('The bundled media-tool version is not the pinned build.');
  }
  if (
    target === 'darwin-arm64' &&
    /--enable-(?:nonfree|gpl|version3)\b/.test(version)
  ) {
    throw new Error('This foundation requires the documented LGPL-only build.');
  }
  if (
    target === 'win32-x64' &&
    (/--enable-(?:nonfree|version3)\b/.test(version) ||
      !['--enable-gpl', '--enable-libx264', '--enable-libx265'].every((flag) =>
        version.includes(flag),
      ))
  )
    throw new Error('Windows requires the documented GPL CPU-encoder build.');
  if (!version.includes('--disable-network')) {
    throw new Error('The bundled media tool must have networking disabled.');
  }
  if (!version.includes('--enable-zlib')) {
    throw new Error(
      'The bundled media tool must include PNG support through system zlib.',
    );
  }
}

export async function validateNativeExecutable(
  file: string,
  target: MediaPlatform = mediaPlatform(),
): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(target === 'win32-x64' ? 64 : 8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (target === 'darwin-arm64') {
      if (
        bytesRead !== 8 ||
        header.readUInt32LE(0) !== 0xfeedfacf ||
        header.readUInt32LE(4) !== 0x0100000c
      )
        throw new Error('Expected a native macOS-arm64 Mach-O executable.');
      return;
    }
    if (bytesRead !== 64 || header.readUInt16LE(0) !== 0x5a4d)
      throw new Error('Expected a native Windows-x64 PE executable.');
    const offset = header.readUInt32LE(60);
    const info = await handle.stat();
    if (offset < 64 || offset > info.size - 6)
      throw new Error('The Windows PE header is truncated or invalid.');
    const signature = Buffer.alloc(6);
    const read = await handle.read(signature, 0, 6, offset);
    if (
      read.bytesRead !== 6 ||
      signature.readUInt32LE(0) !== 0x00004550 ||
      signature.readUInt16LE(4) !== 0x8664
    )
      throw new Error('Expected an x64 PE executable, not x86 or ARM.');
  } finally {
    await handle.close();
  }
}

export async function inspectResource(
  directory: string,
  entry: ResourceEntry,
): Promise<ResourceCheck> {
  const file = join(directory, entry.relativePath);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Expected a regular resource file.');

    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== entry.sha256) {
      throw new Error(
        'Checksum mismatch. Repair or rebuild the bundled resources.',
      );
    }

    let detail = `${entry.license} / checksum verified`;
    if (entry.kind === 'tool') {
      await access(file, constants.X_OK);
      await validateNativeExecutable(file);
      const { stdout } = await runFile(file, ['-version'], {
        timeout: 5000,
        maxBuffer: 128 * 1024,
        shell: false,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
        windowsHide: true,
      });
      validateToolBuild(entry.id, stdout);
      detail = `${stdout.split('\n')[0]} / ${entry.id === 'media-guardian' ? 'parent-death supervision' : `${entry.license} / network disabled`}`;
    }
    return {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      status: 'ready',
      detail,
    };
  } catch (error) {
    console.error(`Resource check failed: ${entry.id}`, error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      status: 'error',
      detail: `${entry.relativePath}: ${message}`,
    };
  }
}

export async function inspectResources(
  directory: string,
): Promise<ResourceCheck[]> {
  try {
    const manifest = await readManifest(directory);
    const required = [
      ...FONT_FACES.map((face) => ({ id: face.id, kind: 'font' })),
      { id: 'ffmpeg', kind: 'tool' },
      { id: 'ffprobe', kind: 'tool' },
      { id: 'media-guardian', kind: 'tool' },
      { id: 'sans-license', kind: 'license' },
      { id: 'serif-license', kind: 'license' },
      { id: 'emoji-license', kind: 'license' },
      { id: 'ffmpeg-license', kind: 'license' },
      { id: 'ffmpeg-license-overview', kind: 'license' },
      { id: 'react-license', kind: 'license' },
      { id: 'react-dom-license', kind: 'license' },
      { id: 'scheduler-license', kind: 'license' },
      { id: 'zod-license', kind: 'license' },
      { id: 'electron-license', kind: 'license' },
      { id: 'chromium-license', kind: 'license' },
      { id: 'ffmpeg-source', kind: 'source' },
      ...(process.platform === 'win32'
        ? [
            { id: 'x264-source', kind: 'source' },
            { id: 'x265-source', kind: 'source' },
            { id: 'zlib-source', kind: 'source' },
            { id: 'x264-license', kind: 'license' },
            { id: 'x265-license', kind: 'license' },
            { id: 'zlib-license', kind: 'license' },
          ]
        : []),
    ];
    for (const resource of required) {
      if (
        !manifest.resources.some(
          (entry) => entry.id === resource.id && entry.kind === resource.kind,
        )
      ) {
        throw new Error(
          `The resource manifest omits required ${resource.kind}: ${resource.id}.`,
        );
      }
    }
    return await Promise.all(
      manifest.resources.map((entry) => inspectResource(directory, entry)),
    );
  } catch (error) {
    console.error('Resource manifest could not be validated.', error);
    return [
      {
        id: 'manifest',
        label: 'Bundled resource manifest',
        kind: 'source',
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
