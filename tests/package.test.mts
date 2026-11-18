import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { extractFile, listPackage } from '@electron/asar';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { z } from 'zod';
import { inspectResources } from '../src/main/resources/diagnostics.ts';
import { readManifest } from '../src/main/resources/manifest.ts';

const root = resolve(import.meta.dirname, '..');
const bundle =
  process.env.VIDEO_EDITOR_PACKAGED_APP ??
  join(root, 'out/Video Text Editor-darwin-arm64/Video Text Editor.app');
const execute = promisify(execFile);

test(
  'macOS review package is self-contained, hardened and includes matching notices/source',
  { timeout: 30000 },
  async (context) => {
    const contents = join(bundle, 'Contents');
    const { stdout } = await execute('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      join(contents, 'Info.plist'),
    ]);
    const info = z
      .object({
        CFBundleExecutable: z.string(),
        CFBundleShortVersionString: z.string(),
        LSMinimumSystemVersion: z.string(),
      })
      .parse(JSON.parse(stdout));
    const { version } = z
      .object({ version: z.string() })
      .parse(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
    assert.equal(info.CFBundleShortVersionString, version);
    assert.equal(info.LSMinimumSystemVersion, '15.0');
    const { stdout: architecture } = await execute('/usr/bin/lipo', [
      '-archs',
      join(contents, 'MacOS', info.CFBundleExecutable),
    ]);
    assert.equal(architecture.trim(), 'arm64');
    const canonicalContents = await realpath(contents);
    for (const entry of await readdir(contents, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink())
        assert.ok(
          (await realpath(join(entry.parentPath, entry.name))).startsWith(
            `${canonicalContents}/`,
          ),
          `The package links outside its own bundle: ${entry.name}`,
        );
    }
    const fuses = await getCurrentFuseWire(bundle);
    for (const option of [
      FuseV1Options.RunAsNode,
      FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseV1Options.EnableNodeCliInspectArguments,
    ])
      assert.equal(
        fuses[option],
        FuseState.DISABLE,
        `Unsafe shipping fuse ${option}`,
      );
    for (const option of [
      FuseV1Options.EnableCookieEncryption,
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
      FuseV1Options.OnlyLoadAppFromAsar,
    ])
      assert.equal(
        fuses[option],
        FuseState.ENABLE,
        `Missing shipping fuse ${option}`,
      );
    const archive = join(contents, 'Resources/app.asar');
    const paths = listPackage(archive, { isPack: false });
    assert.ok(paths.includes('/.vite/build/main.cjs'));
    assert.ok(paths.includes('/.vite/build/preload.cjs'));
    assert.ok(paths.includes('/.vite/build/overlay-preload.cjs'));
    assert.ok(paths.includes('/.vite/renderer/main_window/index.html'));
    assert.ok(
      paths.every(
        (path) =>
          path === '/package.json' ||
          path === '/.vite' ||
          path.startsWith('/.vite/'),
      ),
    );
    const packaged = z
      .object({ version: z.string(), main: z.string() })
      .parse(JSON.parse(extractFile(archive, 'package.json').toString()));
    assert.equal(packaged.version, version);
    assert.ok(paths.includes(`/${packaged.main}`));

    const resources = join(contents, 'Resources/resources');
    const manifest = await readManifest(resources);
    const checks = await inspectResources(resources);
    assert.deepEqual(
      checks.filter((check) => check.status !== 'ready'),
      [],
    );
    await readFile(join(resources, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    await readFile(
      join(resources, 'media-tools/darwin-arm64/BUILD-INFO.txt'),
      'utf8',
    );
    await readFile(
      join(resources, 'media-tools/darwin-arm64/media-guardian.c'),
      'utf8',
    );
    for (const [notice, installed] of [
      ['React.txt', 'react/LICENSE'],
      ['React-DOM.txt', 'react-dom/LICENSE'],
      ['Scheduler.txt', 'scheduler/LICENSE'],
      ['Zod.txt', 'zod/LICENSE'],
      ['Electron.txt', 'electron/dist/LICENSE'],
      ['Chromium.html', 'electron/dist/LICENSES.chromium.html'],
    ] as const) {
      assert.deepEqual(
        await readFile(join(resources, 'licenses', notice)),
        await readFile(join(root, 'node_modules', installed)),
        `${notice} must match the installed runtime dependency.`,
      );
    }
    for (const entry of manifest.resources.filter(
      (entry) => entry.kind === 'tool',
    )) {
      const path = join(resources, entry.relativePath);
      const { stdout: dependencies } = await execute('/usr/bin/otool', [
        '-L',
        path,
      ]);
      for (const line of dependencies.trim().split('\n').slice(1)) {
        assert.match(
          line.trim(),
          /^(?:\/usr\/lib\/|\/System\/Library\/)/,
          `${entry.id} depends on a non-system library: ${line}`,
        );
      }
      const { stdout: build } = await execute('/usr/bin/vtool', [
        '-show-build',
        path,
      ]);
      const minimum = /^\s*minos (\d+)(?:\.(\d+))?/m.exec(build);
      assert.ok(minimum, `${entry.id} must declare a deployment target.`);
      assert.ok(
        Number(minimum[1]) < 15 ||
          (Number(minimum[1]) === 15 && Number(minimum[2] ?? 0) === 0),
        `${entry.id} requires a newer macOS than the advertised minimum.`,
      );
    }
    context.diagnostic(
      JSON.stringify({
        version,
        minimumOS: info.LSMinimumSystemVersion,
        verifiedResources: checks.length,
        shippingFuses: 'enabled',
        nativeDependencies: 'system-only',
      }),
    );
  },
);
