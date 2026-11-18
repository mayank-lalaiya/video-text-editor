import { execFile } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { access, open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FONT_FACES } from '../../shared/fonts.ts';
import type { ResourceCheck } from '../../shared/contracts.ts';
import { readManifest, type ResourceEntry } from './manifest.ts';

const runFile = promisify(execFile);

export function validateToolBuild(id: string, version: string): void {
  if (id === 'media-guardian') {
    if (version.trim() !== 'media-guardian version 1-video-text-editor')
      throw new Error('The bundled worker guardian is not the pinned build.');
    return;
  }
  if (!version.startsWith(`${id} version 9.0.2-video-text-editor-m2`)) {
    throw new Error('The bundled media-tool version is not the pinned build.');
  }
  if (/--enable-(?:nonfree|gpl|version3)\b/.test(version)) {
    throw new Error('This foundation requires the documented LGPL-only build.');
  }
  if (!version.includes('--disable-network')) {
    throw new Error('The bundled media tool must have networking disabled.');
  }
  if (!version.includes('--enable-zlib')) {
    throw new Error(
      'The bundled media tool must include PNG support through system zlib.',
    );
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
      const handle = await open(file, 'r');
      try {
        const header = Buffer.alloc(8);
        const { bytesRead } = await handle.read(header, 0, 8, 0);
        if (
          bytesRead !== 8 ||
          header.readUInt32LE(0) !== 0xfeedfacf ||
          header.readUInt32LE(4) !== 0x0100000c
        ) {
          throw new Error('Expected a native macOS-arm64 Mach-O executable.');
        }
      } finally {
        await handle.close();
      }
      const { stdout } = await runFile(file, ['-version'], {
        timeout: 5000,
        maxBuffer: 128 * 1024,
        shell: false,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
      });
      validateToolBuild(entry.id, stdout);
      detail = `${stdout.split('\n')[0]} / ${entry.id === 'media-guardian' ? 'parent-death supervision' : 'LGPL-2.1-or-later / network disabled'}`;
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
