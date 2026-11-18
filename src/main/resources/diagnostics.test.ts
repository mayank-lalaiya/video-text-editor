import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  inspectResource,
  inspectResources,
  validateToolBuild,
} from './diagnostics.ts';
import type { ResourceEntry } from './manifest.ts';
import { resourceManifestName } from '../platform.ts';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(
    join(tmpdir(), 'video-editor-resource-test-'),
  );
  t.after(() => rm(directory, { recursive: true }));
  const entry: ResourceEntry = {
    id: 'test-font',
    label: 'Test font',
    kind: 'font',
    relativePath: 'font.ttf',
    sha256: createHash('sha256').update('expected-font-bytes').digest('hex'),
    sourceUrl: 'https://example.invalid/font.ttf',
    license: 'Test fixture',
  };
  return { directory, entry };
}

test('a missing font is reported as an error, never ready', async (t) => {
  const { directory, entry } = await fixture(t);
  const check = await inspectResource(directory, entry);
  assert.equal(check.status, 'error');
  assert.match(check.detail, /font\.ttf.*ENOENT/);
});

test('changed resource bytes fail checksum validation', async (t) => {
  const { directory, entry } = await fixture(t);
  await writeFile(join(directory, entry.relativePath), 'expected-font-bytes');
  assert.equal((await inspectResource(directory, entry)).status, 'ready');
  await writeFile(join(directory, entry.relativePath), 'corrupted-font-bytes');
  const check = await inspectResource(directory, entry);
  assert.equal(check.status, 'error');
  assert.match(check.detail, /Checksum mismatch/);
});

test('an invalid disk manifest cannot point outside the bundle', async (t) => {
  const { directory, entry } = await fixture(t);
  await writeFile(
    join(directory, resourceManifestName()),
    JSON.stringify({
      schemaVersion: 1,
      resources: [{ ...entry, relativePath: '../outside.ttf' }],
    }),
  );
  const checks = await inspectResources(directory);
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.status, 'error');
  assert.match(checks[0]?.detail ?? '', /stay inside/);
});

test('an empty manifest cannot produce a successful resource report', async (t) => {
  const { directory } = await fixture(t);
  await writeFile(
    join(directory, resourceManifestName()),
    '{"schemaVersion":1,"resources":[]}',
  );
  const checks = await inspectResources(directory);
  assert.equal(checks[0]?.status, 'error');
  assert.match(checks[0]?.detail ?? '', /omits required/);
});

test('native build checks reject nonfree components even with the right version', () => {
  assert.throws(
    () =>
      validateToolBuild(
        'ffmpeg',
        'ffmpeg version 9.0.2-video-text-editor-m2\nconfiguration: --disable-network --enable-zlib --enable-nonfree',
        'darwin-arm64',
      ),
    /LGPL-only/,
  );
});

test('native build checks require disabled networking', () => {
  assert.throws(
    () =>
      validateToolBuild(
        'ffprobe',
        'ffprobe version 9.0.2-video-text-editor-m2\nconfiguration: --disable-autodetect --enable-zlib',
        'darwin-arm64',
      ),
    /networking disabled/,
  );
});

test('native build checks require the PNG/zlib capability used by real imports', () => {
  assert.throws(
    () =>
      validateToolBuild(
        'ffmpeg',
        'ffmpeg version 9.0.2-video-text-editor-m2\nconfiguration: --disable-network',
        'darwin-arm64',
      ),
    /PNG support/,
  );
});
