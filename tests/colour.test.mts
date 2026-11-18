import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  exportPlan,
  hdrDecodeFilters,
  hdrEncodeFilters,
  hdrInputFilters,
} from '../src/main/media/colour.ts';
import {
  describeVideo,
  validateOutput,
  validateHdrFrames,
  sourceVideoBitrate,
  type Probe,
} from '../src/main/media/probe.ts';
import type { VideoColour } from '../src/shared/editor.ts';
import { mediaToolPath } from '../src/main/platform.ts';

const ffmpeg = fileURLToPath(
  new URL(`../resources/${mediaToolPath('ffmpeg')}`, import.meta.url),
);
const execute = (args: string[], input?: Buffer) =>
  execFileSync(
    ffmpeg,
    ['-nostdin', '-v', 'error', '-noauto_conversion_filters', ...args],
    { input, maxBuffer: 8 * 1024 * 1024 },
  );
const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );

function floatFrame(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2 * 3 * 4);
  for (let channel = 0; channel < 3; channel += 1)
    for (let y = 0; y < 2; y += 1)
      values.forEach((value, x) =>
        buffer.writeFloatLE(
          value,
          (channel * values.length * 2 + y * values.length + x) * 4,
        ),
      );
  return buffer;
}

function transform(input: Buffer, width: number, filter: string): Buffer {
  return execute(
    [
      '-f',
      'rawvideo',
      '-pixel_format',
      'gbrpf32le',
      '-video_size',
      `${width}x2`,
      '-i',
      'pipe:0',
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-pix_fmt',
      'gbrpf32le',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    input,
  );
}

test('PQ/HLG float transforms preserve peaks, reference white and dense gradients', () => {
  for (const transfer of ['hlg', 'pq'] as const) {
    const values = Array.from({ length: 1024 }, (_, index) => index / 1023);
    const input = floatFrame(values);
    const decoded = transform(input, values.length, hdrDecodeFilters(transfer));
    close(
      decoded.readFloatLE(1023 * 4),
      transfer === 'hlg' ? 1000 : 10000,
      0.02,
    );
    const roundtrip = transform(
      decoded,
      values.length,
      hdrEncodeFilters(transfer),
    );
    let maximumError = 0;
    for (let offset = 0; offset < input.length; offset += 4)
      maximumError = Math.max(
        maximumError,
        Math.abs(input.readFloatLE(offset) - roundtrip.readFloatLE(offset)),
      );
    assert.ok(maximumError < 0.000002, `${transfer}: ${maximumError}`);
    const white = transform(
      floatFrame([203, 203]),
      2,
      hdrEncodeFilters(transfer),
    );
    close(
      white.readFloatLE(0),
      transfer === 'hlg' ? 0.74988 : 0.580689,
      0.00002,
    );
  }
  const pq = transform(floatFrame([0.5, 0.75]), 2, hdrDecodeFilters('pq'));
  close(pq.readFloatLE(0), 92.2457, 0.001);
  close(pq.readFloatLE(4), 983.3779, 0.01);
  const hlg = transform(floatFrame([0.5, 0.75]), 2, hdrDecodeFilters('hlg'));
  close(hlg.readFloatLE(0), 50.697, 0.001);
  close(hlg.readFloatLE(4), 203.1521, 0.001);
});

test('the actual HDR graph retains 10-bit gradients and blends sRGB text in float light', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-hdr-colour-'));
  const width = 1024;
  const height = 64;
  const yuv = Buffer.alloc(width * height * 3 * 2);
  const overlay = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x;
      yuv.writeUInt16LE(64 + Math.round((876 * x) / (width - 1)), position * 2);
      yuv.writeUInt16LE(512, (width * height + position) * 2);
      yuv.writeUInt16LE(512, (2 * width * height + position) * 2);
      overlay[position * 4] = 255;
      overlay[position * 4 + 1] = y < 48 ? 255 : 128;
      overlay[position * 4 + 2] = y < 48 ? 255 : 0;
      overlay[position * 4 + 3] = y < 16 ? 0 : y < 32 ? 128 : 255;
    }
  }
  const source = join(directory, 'gradient.yuv');
  const text = join(directory, 'text.rgba');
  try {
    await Promise.all([writeFile(source, yuv), writeFile(text, overlay)]);
    for (const dynamicRange of ['hlg', 'pq'] as const) {
      const colour: VideoColour = {
        dynamicRange,
        range: 'limited',
        dolbyVision: false,
      };
      const plan = exportPlan({ colour }, 0, 1000000, 'hevc');
      const pixelFormat =
        plan.encodingArgs[plan.encodingArgs.indexOf('-pix_fmt') + 1]!;
      assert.ok(['p010le', 'yuv420p10le'].includes(pixelFormat));
      const output = execute([
        '-f',
        'rawvideo',
        '-pixel_format',
        'yuv444p10le',
        '-video_size',
        `${width}x${height}`,
        '-i',
        source,
        '-f',
        'rawvideo',
        '-pixel_format',
        'rgba',
        '-video_size',
        `${width}x${height}`,
        '-i',
        text,
        '-filter_complex_threads',
        '2',
        '-filter_complex',
        plan.filter,
        '-map',
        '[out]',
        '-frames:v',
        '1',
        '-pix_fmt',
        pixelFormat,
        '-f',
        'rawvideo',
        'pipe:1',
      ]);
      const sample = (offset: number) =>
        output.readUInt16LE(offset) >> (pixelFormat === 'p010le' ? 6 : 0);
      const levels = new Set<number>();
      for (let x = 0; x < width; x += 1) {
        const code = sample(x * 2);
        const original = yuv.readUInt16LE(x * 2);
        close(code, original, 1);
        levels.add(code);
      }
      assert.ok(
        levels.size > 800,
        `${dynamicRange}: only ${levels.size} levels`,
      );
      const decoded = execute(
        [
          '-f',
          'rawvideo',
          '-pixel_format',
          pixelFormat,
          '-video_size',
          `${width}x${height}`,
          '-i',
          'pipe:0',
          '-vf',
          hdrInputFilters(colour),
          '-frames:v',
          '1',
          '-pix_fmt',
          'gbrpf32le',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        output,
      );
      const rgb = (x: number, y: number) =>
        [2, 0, 1].map((plane) =>
          decoded.readFloatLE((plane * width * height + y * width + x) * 4),
        );
      rgb(0, 24).forEach((value) => close(value, (203 * 128) / 255, 1.5));
      const whiteSignal = dynamicRange === 'hlg' ? 0.74988 : 0.580689;
      close(sample((40 * width + 512) * 2), 64 + 876 * whiteSignal, 1);
      rgb(512, 40).forEach((value) => close(value, 203, 2));
      // Independent Rec.709 -> Rec.2020 reference matrix applied to linear
      // sRGB orange (#FF8000), at the 203 cd/m² graphics-white level.
      const green = ((128 / 255 + 0.055) / 1.055) ** 2.4;
      const expected = [
        203 * (0.627403896 + 0.329283038 * green),
        203 * (0.069097289 + 0.919540395 * green),
        203 * (0.016391439 + 0.088013308 * green),
      ];
      rgb(512, 56).forEach((value, index) => close(value, expected[index]!, 2));
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

function hdrProbe(transfer: 'hlg' | 'pq'): Probe {
  return {
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'hevc',
        codec_tag_string: 'hvc1',
        profile: 'Main 10',
        width: 320,
        height: 180,
        start_time: '0',
        avg_frame_rate: '25/1',
        nb_frames: '50',
        pix_fmt: 'yuv420p10le',
        color_transfer: transfer === 'hlg' ? 'arib-std-b67' : 'smpte2084',
        color_primaries: 'bt2020',
        color_space: 'bt2020nc',
        color_range: 'tv',
      },
    ],
    format: { duration: '2' },
  };
}

test('exports retain the source codec with bounded bitrate and reject invalid rate control', () => {
  const source = hdrProbe('hlg');
  const stream = source.streams[0]!;
  Object.assign(stream, {
    pix_fmt: 'yuv420p',
    profile: 'Main',
    color_transfer: 'bt709',
    color_space: 'bt709',
    color_primaries: 'bt709',
  });
  const asset = describeVideo(source, randomUUID(), 'hevc-sdr.mp4');
  const plan = exportPlan(asset, 0, 22000000, 'hevc', 'darwin-arm64');
  assert.equal(
    plan.encodingArgs[plan.encodingArgs.indexOf('-c:v') + 1],
    'hevc_videotoolbox',
  );
  assert.equal(
    plan.encodingArgs[plan.encodingArgs.indexOf('-profile:v') + 1],
    'main',
  );
  assert.equal(
    plan.encodingArgs[plan.encodingArgs.indexOf('-b:v') + 1],
    '33000000',
  );
  assert.ok(!plan.encodingArgs.includes('-q:v'));
  assert.doesNotThrow(() => validateOutput(source, source, asset));
  assert.throws(
    () =>
      validateOutput(
        source,
        { ...source, streams: [{ ...stream, codec_name: 'h264' }] },
        asset,
      ),
    /codec/,
  );
  const h264 = exportPlan(asset, 0, 1000000, 'h264', 'darwin-arm64');
  assert.equal(
    h264.encodingArgs[h264.encodingArgs.indexOf('-c:v') + 1],
    'h264_videotoolbox',
  );
  for (const bitrate of [0, -1, NaN, Infinity])
    assert.throws(() => exportPlan(asset, 0, bitrate, 'hevc'), /bitrate/);
  assert.throws(() => exportPlan(asset, 0, 1000000, undefined), /codec/);
});

test('missing video bitrate is measured from only the selected video packets, never audio or container size', async () => {
  const probe = hdrProbe('hlg');
  probe.streams[0]!.index = 2;
  const signal = new AbortController().signal;
  let calls = 0;
  const worker = {
    run: async (_file: string, args: string[], received: AbortSignal) => {
      calls++;
      assert.equal(args[args.indexOf('-select_streams') + 1], '2');
      assert.equal(received, signal);
      return '1000\n2000\n';
    },
  };
  assert.equal(
    await sourceVideoBitrate(worker, 'ffprobe', 'clip.mp4', probe, signal),
    12000,
  );
  probe.streams[0]!.bit_rate = '22000000';
  assert.equal(
    await sourceVideoBitrate(worker, 'ffprobe', 'clip.mp4', probe, signal),
    22000000,
  );
  assert.equal(calls, 1);
  delete probe.streams[0]!.bit_rate;
  await assert.rejects(
    sourceVideoBitrate(
      { run: async () => 'N/A\n' },
      'ffprobe',
      'clip.mp4',
      probe,
      signal,
    ),
    /packet sizes/,
  );
});

test('HDR classification accepts compatible bases and rejects ambiguous colour or Dolby variants', () => {
  for (const transfer of ['hlg', 'pq'] as const) {
    const source = hdrProbe(transfer);
    const stream = source.streams[0]!;
    stream.side_data_list = [
      {
        side_data_type: 'DOVI configuration record',
        dv_profile: 8,
        bl_present_flag: 1,
        el_present_flag: 0,
        dv_bl_signal_compatibility_id: transfer === 'hlg' ? 4 : 1,
      },
    ];
    assert.deepEqual(describeVideo(source, randomUUID(), 'hdr.mov').colour, {
      dynamicRange: transfer,
      range: 'limited',
      dolbyVision: true,
    });
    for (const field of [
      'color_primaries',
      'color_space',
      'color_range',
      'pix_fmt',
    ] as const) {
      assert.throws(
        () =>
          describeVideo(
            {
              ...source,
              streams: [{ ...stream, [field]: undefined }],
            },
            randomUUID(),
            'ambiguous.mov',
          ),
        /HDR input needs tagged/,
      );
    }
    for (const patch of [
      { dv_profile: 5 },
      { el_present_flag: 1 },
      { bl_present_flag: 0 },
      { dv_bl_signal_compatibility_id: 0 },
    ])
      assert.throws(
        () =>
          describeVideo(
            {
              ...source,
              streams: [
                {
                  ...stream,
                  side_data_list: [{ ...stream.side_data_list![0], ...patch }],
                },
              ],
            },
            randomUUID(),
            'unsupported.mov',
          ),
        /Dolby Vision variant/,
      );
  }
});

test('HDR output validation requires Main10, preserved signalling and no stale dynamic metadata', () => {
  for (const transfer of ['hlg', 'pq'] as const) {
    const source = hdrProbe(transfer);
    const asset = describeVideo(source, randomUUID(), 'hdr.mov');
    assert.doesNotThrow(() => validateOutput(source, source, asset));
    for (const patch of [
      { pix_fmt: 'yuv420p' },
      { profile: 'Main' },
      { codec_tag_string: 'hev1' },
      { color_transfer: 'bt709' },
      { color_primaries: 'bt709' },
      { color_space: 'bt709' },
      { color_range: 'pc' },
      { side_data_list: [{ side_data_type: 'DOVI configuration record' }] },
      {
        side_data_list: [
          { side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' },
        ],
      },
    ])
      assert.throws(
        () =>
          validateOutput(
            source,
            {
              ...source,
              streams: [{ ...source.streams[0]!, ...patch }],
            },
            asset,
          ),
        /Output HDR validation failed/,
      );
  }
});

test('10-bit SDR stays 10-bit and invalid output signalling or unsupported precision is rejected', () => {
  const base = hdrProbe('hlg');
  const source: Probe = {
    ...base,
    streams: base.streams.map((stream) => ({
      ...stream,
      color_transfer: 'bt709',
      color_space: 'bt709',
      color_primaries: 'bt709',
    })),
  };
  const asset = describeVideo(source, randomUUID(), 'sdr10.mp4');
  assert.deepEqual(asset.colour, { dynamicRange: 'sdr', bitDepth: 10 });
  assert.doesNotThrow(() => validateOutput(source, source, asset));
  for (const patch of [
    { pix_fmt: 'yuv420p' },
    { color_range: 'pc' },
    { color_transfer: undefined },
  ]) {
    assert.throws(
      () =>
        validateOutput(
          source,
          {
            ...source,
            streams: source.streams.map((stream) => ({ ...stream, ...patch })),
          },
          asset,
        ),
      /SDR validation failed/,
    );
  }
  assert.throws(
    () =>
      describeVideo(
        {
          ...source,
          streams: source.streams.map((stream) => ({
            ...stream,
            pix_fmt: 'yuv420p12le',
          })),
        },
        randomUUID(),
        'sdr12.mp4',
      ),
    /not silently reduced/,
  );
});

test('unsupported Apple spatial audio is reported instead of silently discarded', () => {
  const source = hdrProbe('hlg');
  source.streams.push({
    index: 1,
    codec_type: 'audio',
    codec_name: 'apple_apac',
    channels: 4,
    start_time: '0',
  });
  assert.throws(
    () => describeVideo(source, randomUUID(), 'spatial.mov'),
    /Apple APAC spatial audio.*No audio tracks have been dropped/,
  );
});

test('HDR validation scans every encoded frame and rejects a Dolby leak or unverifiable output', async () => {
  const signal = new AbortController().signal;
  for (const metadata of [
    'Dolby Vision RPU Data',
    'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)',
    'Mastering display metadata',
  ]) {
    await assert.rejects(
      validateHdrFrames(
        {
          run: async () =>
            JSON.stringify({
              frames: [{}, { side_data_list: [{ side_data_type: metadata }] }],
            }),
        },
        'ffprobe',
        'output.mp4',
        signal,
      ),
      /metadata remains in encoded frames/,
    );
  }
  await assert.rejects(
    validateHdrFrames(
      {
        run: async () => JSON.stringify({ frames: [] }),
      },
      'ffprobe',
      'empty.mp4',
      signal,
    ),
  );
  await validateHdrFrames(
    {
      run: async () =>
        JSON.stringify({
          frames: [
            {},
            {
              side_data_list: [
                {
                  side_data_type: 'H.26[45] User Data Unregistered SEI message',
                },
              ],
            },
          ],
        }),
    },
    'ffprobe',
    'clean.mp4',
    signal,
  );
});
