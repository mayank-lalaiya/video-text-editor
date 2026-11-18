import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ResourceManifestSchema } from '../src/main/resources/manifest.ts';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Build the worker guardian on an Apple-silicon Mac.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'resources/media-tools/darwin-arm64');
const binary = join(directory, 'media-guardian');
await promisify(execFile)('clang', [
  '-std=c11',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-arch',
  'arm64',
  '-mmacosx-version-min=15.0',
  join(directory, 'media-guardian.c'),
  '-o',
  binary,
]);
const path = join(root, 'resources/manifest.json');
const manifest = ResourceManifestSchema.parse(
  JSON.parse(await readFile(path, 'utf8')),
);
const entry = {
  id: 'media-guardian',
  label: 'Media worker guardian',
  kind: 'tool' as const,
  relativePath: 'media-tools/darwin-arm64/media-guardian',
  sha256: createHash('sha256')
    .update(await readFile(binary))
    .digest('hex'),
  sourceUrl: 'file:///bundled/media-tools/darwin-arm64/media-guardian.c',
  license: 'Project source (UNLICENSED)',
};
manifest.resources = [
  ...manifest.resources.filter((resource) => resource.id !== entry.id),
  entry,
];
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Built and pinned the macOS media worker guardian.');
