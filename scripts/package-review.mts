import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { api } from '@electron-forge/core';
import { z } from 'zod';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Review packaging requires macOS on Apple silicon.');

const root = resolve(import.meta.dirname, '..');
const { version } = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .parse(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
const outDir = join(root, 'out', `preview-${version}`);
await mkdir(join(root, 'out'), { recursive: true });
// Refuse to replace an older review build, including one that may be running.
await mkdir(outDir);
console.log(`Building an unsigned local review package in ${outDir}`);
await api.make({ dir: root, platform: 'darwin', arch: 'arm64', outDir });
console.log(`Review package ready: ${outDir}`);
