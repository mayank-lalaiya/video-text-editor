import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ResourceManifestSchema,
  type ResourceEntry,
} from '../src/main/resources/manifest.ts';
import {
  validateNativeExecutable,
  validateToolBuild,
} from '../src/main/resources/diagnostics.ts';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error(
    'Prepare Windows resources on Windows x64 after the native build.',
  );

const root = resolve(import.meta.dirname, '..');
const resources = join(root, 'resources');
const native = 'media-tools/win32-x64';
const manifest = ResourceManifestSchema.parse(
  JSON.parse(await readFile(join(resources, 'manifest.json'), 'utf8')),
);
const sources = z
  .record(
    z.string(),
    z.object({
      url: z.url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      license: z.string(),
    }),
  )
  .parse(
    JSON.parse(await readFile(join(resources, native, 'sources.json'), 'utf8')),
  );
const replaced = new Set([
  'ffmpeg',
  'ffprobe',
  'media-guardian',
  'ffmpeg-source',
  'ffmpeg-license',
  'ffmpeg-license-overview',
  'electron-license',
  'chromium-license',
]);
const entries = manifest.resources.filter((entry) => !replaced.has(entry.id));

async function add(entry: Omit<ResourceEntry, 'sha256'>, expected?: string) {
  const file = join(resources, entry.relativePath);
  const sha256 = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  if (expected && sha256 !== expected)
    throw new Error(`Source checksum mismatch: ${entry.id}`);
  entries.push({ ...entry, sha256 });
}

for (const name of ['ffmpeg', 'ffprobe', 'media-guardian'] as const) {
  const relativePath = `${native}/${name}.exe`;
  const file = join(resources, relativePath);
  await validateNativeExecutable(file, 'win32-x64');
  const version = execFileSync(file, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  validateToolBuild(name, version, 'win32-x64');
  const dependencies = execFileSync('objdump', ['-p', file], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const imports = Array.from(
    dependencies.matchAll(/DLL Name:\s*(\S+)/gi),
    (match) => match[1]!,
  );
  if (!imports.length)
    throw new Error(`${name} has no readable native DLL imports.`);
  const unbundled = imports.filter((dependency) =>
    /msys-|libwinpthread|libstdc\+\+|libgcc|libx26[45]|zlib|avcodec|avformat|avutil|swscale|swresample/i.test(
      dependency,
    ),
  );
  if (unbundled.length)
    throw new Error(
      `${name} requires unbundled non-system DLLs: ${unbundled.join(', ')}`,
    );
  await add({
    id: name,
    label: name === 'media-guardian' ? 'Windows media worker guardian' : name,
    kind: 'tool',
    relativePath,
    sourceUrl:
      name === 'media-guardian'
        ? 'file:///bundled/media-tools/win32-x64/media-guardian.c'
        : 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    license:
      name === 'media-guardian'
        ? 'Project source (UNLICENSED)'
        : 'GPL-2.0-or-later',
  });
}
await add(
  {
    id: 'ffmpeg-source',
    label: 'Corresponding FFmpeg source',
    kind: 'source',
    relativePath: `${native}/sources/ffmpeg-9.0.2.tar.xz`,
    sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    license: 'GPL-2.0-or-later; individual source-file notices apply',
  },
  manifest.resources.find((entry) => entry.id === 'ffmpeg-source')!.sha256,
);
for (const [name, source] of Object.entries(sources)) {
  await add(
    {
      id: `${name}-source`,
      label: `Corresponding ${name} source`,
      kind: 'source',
      relativePath: `${native}/sources/${name}.tar.gz`,
      sourceUrl: source.url,
      license: source.license,
    },
    source.sha256,
  );
  await add({
    id: `${name}-license`,
    label: `${name} license`,
    kind: 'license',
    relativePath: `${native}/licenses/${name}.txt`,
    sourceUrl: source.url,
    license: source.license,
  });
}
for (const [id, file] of [
  ['ffmpeg-license', 'ffmpeg-gpl.txt'],
  ['ffmpeg-license-overview', 'ffmpeg-overview.md'],
] as const)
  await add({
    id,
    label: id,
    kind: 'license',
    relativePath: `${native}/licenses/${file}`,
    sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    license: 'GPL-2.0-or-later',
  });
const electron = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(
      await readFile(join(root, 'node_modules/electron/package.json'), 'utf8'),
    ),
  );
await mkdir(join(resources, 'licenses/windows'), { recursive: true });
for (const [id, from, to] of [
  ['electron-license', 'LICENSE', 'Electron.txt'],
  ['chromium-license', 'LICENSES.chromium.html', 'Chromium.html'],
] as const) {
  await copyFile(
    join(root, 'node_modules/electron/dist', from),
    join(resources, 'licenses/windows', to),
  );
  await add({
    id,
    label: id,
    kind: 'license',
    relativePath: `licenses/windows/${to}`,
    sourceUrl: `https://github.com/electron/electron/releases/download/v${electron.version}/electron-v${electron.version}-win32-x64.zip`,
    license:
      id === 'electron-license'
        ? 'MIT'
        : 'Multiple licenses; see full bundled notices',
  });
}
const result = ResourceManifestSchema.parse({
  schemaVersion: 1,
  resources: entries,
});
for (const script of [
  'build-windows-media.sh',
  'prepare-windows-resources.mts',
])
  await copyFile(
    join(root, 'scripts', script),
    join(resources, native, script),
  );
await writeFile(
  join(resources, 'manifest.win32-x64.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  `Pinned ${entries.length} Windows offline resources; macOS manifest unchanged.`,
);
