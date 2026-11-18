import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mediaPlatform, mediaToolPath } from '../src/main/platform.ts';
import { exportPlan } from '../src/main/media/colour.ts';
import { previewArguments } from '../src/main/media/preview.ts';
import {
  validateNativeExecutable,
  validateToolBuild,
} from '../src/main/resources/diagnostics.ts';
import type { VideoAsset } from '../src/shared/editor.ts';

test('Windows uses x64 executables and CPU encoders without accepting unsupported architectures', () => {
  assert.equal(mediaPlatform('win32', 'x64'), 'win32-x64');
  assert.throws(() => mediaPlatform('win32', 'ia32'), /x64/);
  assert.throws(() => mediaPlatform('win32', 'arm64'), /x64/);
  assert.equal(
    mediaToolPath('ffmpeg', 'win32-x64'),
    'media-tools/win32-x64/ffmpeg.exe',
  );
  const asset: VideoAsset = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'sample.mp4',
    width: 320,
    height: 180,
    sampleAspectRatio: 1,
    rotation: 0,
    duration: 2,
    audioChannels: [],
    colour: { dynamicRange: 'sdr', bitDepth: 8 },
  };
  for (const codec of ['h264', 'hevc'] as const) {
    const plan = exportPlan(asset, 0, 2000000, codec, 'win32-x64');
    assert.equal(
      plan.encodingArgs[plan.encodingArgs.indexOf('-c:v') + 1],
      codec === 'h264' ? 'libx264' : 'libx265',
    );
    assert.ok(!plan.encodingArgs.join(' ').includes('videotoolbox'));
    assert.equal(
      plan.encodingArgs[plan.encodingArgs.indexOf('-b:v') + 1],
      '3000000',
    );
  }
  for (const dynamicRange of ['hlg', 'pq'] as const) {
    const plan = exportPlan(
      { colour: { dynamicRange, range: 'limited', dolbyVision: false } },
      0,
      2000000,
      'hevc',
      'win32-x64',
    );
    assert.ok(plan.encodingArgs.includes('libx265'));
    assert.ok(plan.encodingArgs.includes('main10'));
    assert.ok(plan.encodingArgs.includes('yuv420p10le'));
    assert.ok(plan.filter.includes('format=yuv420p10le'));
    assert.ok(plan.encodingArgs.includes('dovi_rpu=strip=1'));
  }
  const preview = previewArguments(
    'sample.mp4',
    asset,
    0,
    0,
    true,
    'win32-x64',
  );
  assert.ok(preview.includes('libx264'));
  assert.ok(preview.includes('zerolatency'));
  assert.ok(!preview.join(' ').includes('videotoolbox'));
  assert.ok(!preview.join(' ').includes('scale_vt'));
});

test('native checks reject x86, ARM and malformed Windows PE files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-pe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'tool.exe');
  const bytes = Buffer.alloc(134);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x00004550, 128);
  bytes.writeUInt16LE(0x8664, 132);
  await writeFile(file, bytes);
  await validateNativeExecutable(file, 'win32-x64');
  for (const machine of [0x14c, 0xaa64]) {
    bytes.writeUInt16LE(machine, 132);
    await writeFile(file, bytes);
    await assert.rejects(validateNativeExecutable(file, 'win32-x64'), /x64 PE/);
  }
  bytes.writeUInt32LE(4096, 60);
  await writeFile(file, bytes);
  await assert.rejects(
    validateNativeExecutable(file, 'win32-x64'),
    /truncated/,
  );
});

test('Windows accepts only its documented offline GPL CPU build without weakening Mac checks', () => {
  const version =
    'ffmpeg version 9.0.2-video-text-editor-win1\nconfiguration: --disable-network --enable-zlib --enable-gpl --enable-libx264 --enable-libx265';
  validateToolBuild('ffmpeg', version, 'win32-x64');
  assert.throws(
    () =>
      validateToolBuild(
        'ffmpeg',
        version.replace(' --enable-libx265', ''),
        'win32-x64',
      ),
    /GPL CPU/,
  );
  assert.throws(
    () =>
      validateToolBuild('ffmpeg', `${version} --enable-nonfree`, 'win32-x64'),
    /GPL CPU/,
  );
  assert.throws(
    () => validateToolBuild('ffmpeg', version, 'darwin-arm64'),
    /pinned build/,
  );
});
