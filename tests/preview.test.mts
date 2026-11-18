import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { z } from 'zod';
import { MediaWorker } from '../src/main/media/worker.ts';
import { PreviewService } from '../src/main/media/preview.ts';
import type { VideoAsset } from '../src/shared/editor.ts';
import { mediaToolPath } from '../src/main/platform.ts';

const execute = promisify(execFile);
const ffmpeg = resolve('resources', mediaToolPath('ffmpeg'));
const ffprobe = resolve('resources', mediaToolPath('ffprobe'));
const guardian = resolve('resources', mediaToolPath('media-guardian'));

test('completed worker jobs release their process and abort listener across reuse', async () => {
  const worker = new MediaWorker({
    file: guardian,
    cleanupDirectories: () => [],
  });
  const controller = new AbortController();
  for (let index = 0; index < 16; index++) {
    const output = await worker.run(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.pid));'],
      controller.signal,
    );
    const pid = Number(output);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test(
  'cancellation reaps an owned worker that ignores SIGTERM',
  { timeout: 10000 },
  async () => {
    const worker = new MediaWorker({
      file: guardian,
      cleanupDirectories: () => [],
    });
    const controller = new AbortController();
    const job = worker.stream(
      process.execPath,
      [
        '-e',
        'process.on("SIGTERM",()=>{});process.stdout.write(String(process.pid));setInterval(()=>{},1000);',
      ],
      controller,
    );
    const reader = job.body.getReader();
    const completion = assert.rejects(job.done, /cancelled/);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let forced = false;
    try {
      const first = await reader.read();
      const pid = Number(new TextDecoder().decode(first.value));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      watchdog = setTimeout(() => {
        forced = true;
        process.kill(pid, 'SIGKILL');
      }, 6500);
      await reader.cancel();
      await completion;
      assert.equal(
        forced,
        false,
        'The worker must enforce its own kill deadline.',
      );
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally {
      controller.abort();
      try {
        await completion;
      } finally {
        if (watchdog) clearTimeout(watchdog);
        reader.releaseLock();
      }
    }
  },
);

test('cancelling a backpressured binary stream closes its owned worker promptly', async () => {
  const worker = new MediaWorker();
  const controller = new AbortController();
  const job = worker.stream(
    process.execPath,
    [
      '-e',
      'const bytes=Buffer.alloc(65536);function write(){while(process.stdout.write(bytes)) {}}process.stdout.on("drain",write);write();',
    ],
    controller,
  );
  const reader = job.body.getReader();
  assert.ok((await reader.read()).value?.length);
  const started = performance.now();
  await reader.cancel();
  await assert.rejects(job.done, /cancelled/);
  assert.ok(performance.now() - started < 5000);
});

test(
  'preview sessions supersede safely and produce bounded decodable fMP4 with aligned audio',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-preview-stream-'),
    );
    const preview = new PreviewService();
    try {
      const source = join(directory, 'source.mp4');
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=1280x720:r=30:d=12',
        '-f',
        'lavfi',
        '-i',
        'aevalsrc=if(eq(mod(n\\,48000)\\,19200)\\,0.8\\,0):s=48000:d=12',
        '-c:v',
        process.platform === 'win32' ? 'libx264' : 'h264_videotoolbox',
        '-b:v',
        '1M',
        '-g',
        '30',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-shortest',
        source,
      ]);
      const asset: VideoAsset = {
        id: randomUUID(),
        name: 'source.mp4',
        width: 1280,
        height: 720,
        sampleAspectRatio: 1,
        duration: 12,
        rotation: 0,
        audioChannels: [2],
        colour: { dynamicRange: 'sdr', bitDepth: 8 },
      };
      const first = await preview.start(ffmpeg, source, asset, 0, 0);
      assert.ok(first.ok && first.outcome === 'started');
      const replacements = await Promise.all(
        [1, 4, 2.2].map((start) =>
          preview.start(ffmpeg, source, asset, 0, start),
        ),
      );
      assert.ok(
        replacements
          .slice(0, -1)
          .every((item) => item.ok && item.outcome === 'cancelled'),
      );
      const current = replacements.at(-1);
      assert.ok(current?.ok && current.outcome === 'started');
      assert.equal(preview.respond(new Request(first.session.url)).status, 404);
      await preview.stop(first.session.id);
      const response = preview.respond(new Request(current.session.url));
      assert.equal(response.status, 200);
      const bytes = await response.arrayBuffer();
      assert.ok(bytes.byteLength < 2 * 1024 * 1024);
      const path = join(directory, 'preview.mp4');
      await writeFile(path, new Uint8Array(bytes));
      const { stdout } = await execute(ffprobe, [
        '-v',
        'error',
        '-count_frames',
        '-show_streams',
        '-of',
        'json',
        path,
      ]);
      const info = z
        .object({
          streams: z.array(
            z.object({
              codec_type: z.string(),
              codec_name: z.string(),
              width: z.number().optional(),
              height: z.number().optional(),
              nb_read_frames: z.coerce.number().optional(),
              avg_frame_rate: z.string().optional(),
              color_transfer: z.string().optional(),
            }),
          ),
        })
        .parse(JSON.parse(stdout));
      const video = info.streams.find((item) => item.codec_type === 'video');
      assert.ok(video);
      assert.equal(video.codec_name, 'h264');
      assert.equal(video.width, 720);
      assert.equal(video.height, 406);
      assert.equal(video.avg_frame_rate, '15/1');
      assert.equal(video.color_transfer, 'bt709');
      assert.ok(video.nb_read_frames && video.nb_read_frames <= 120);
      assert.equal(
        info.streams.filter((item) => item.codec_type === 'audio').length,
        1,
      );
      const audio = await execute(
        ffmpeg,
        [
          '-v',
          'error',
          '-i',
          path,
          '-map',
          '0:a:0',
          '-t',
          '0.8',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: 1024 * 1024 },
      );
      let peak = 0,
        index = 0;
      for (let offset = 0; offset < audio.stdout.length; offset += 4) {
        const sample = Math.abs(audio.stdout.readFloatLE(offset));
        if (sample > peak) {
          peak = sample;
          index = offset / 4;
        }
      }
      assert.ok(peak > 0.1);
      assert.ok(
        Math.abs(index / 48000 - 0.2) <= 0.02,
        `Preview impulse at ${index / 48000}s, expected 0.2s.`,
      );
    } finally {
      await preview.stop();
      await rm(directory, { recursive: true });
    }
  },
);
