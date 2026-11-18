import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  inspectResources,
  validateNativeExecutable,
} from '../src/main/resources/diagnostics.ts';
import { readManifest } from '../src/main/resources/manifest.ts';
import { SavedWorkspaceSchema } from '../src/main/workspace/store.ts';
import { emptyWorkspace } from '../src/shared/workspace.ts';
import {
  describeVideo,
  probeVideo,
  validateHdrFrames,
  validateOutput,
} from '../src/main/media/probe.ts';
import { MediaWorker } from '../src/main/media/worker.ts';
import { setNativeFiles, withPackagedApp } from './packaged-app.mts';
import { finishCurrentExport, startCurrentExport } from './export-helpers.mts';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';

const windowsTest = process.platform === 'win32' ? test : test.skip;
const application =
  process.env.VIDEO_EDITOR_WINDOWS_APP ??
  resolve('out/Video Text Editor-win32-x64');
const resources = join(application, 'resources/resources');
const ffmpeg = join(resources, 'media-tools/win32-x64/ffmpeg.exe');
const ffprobe = join(resources, 'media-tools/win32-x64/ffprobe.exe');
const execute = promisify(execFile);
const digest = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const run = async (args: string[]) =>
  execute(ffmpeg, ['-nostdin', '-v', 'error', ...args], {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });

async function waitForOverlay(directory: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 600; attempt++) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('.video-text-editor-'))
        continue;
      try {
        const png = await readFile(join(directory, entry.name, 'text.png'));
        if (
          png.length > 32 &&
          png.subarray(-8, -4).toString('ascii') === 'IEND'
        )
          return png;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        )
          throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    'The Windows export did not produce its full-resolution text overlay.',
  );
}

windowsTest(
  'Windows portable package has x64 offline resources, corresponding source and shipping fuses',
  async () => {
    const executable = join(application, 'Video Text Editor.exe');
    await validateNativeExecutable(executable, 'win32-x64');
    const fuses = await getCurrentFuseWire(executable);
    assert.equal(fuses[FuseV1Options.RunAsNode], FuseState.DISABLE);
    assert.equal(
      fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable],
      FuseState.DISABLE,
    );
    assert.equal(
      fuses[FuseV1Options.EnableNodeCliInspectArguments],
      FuseState.DISABLE,
    );
    assert.equal(
      fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
      FuseState.ENABLE,
    );
    const checks = await inspectResources(resources);
    assert.deepEqual(
      checks.filter((check) => check.status !== 'ready'),
      [],
    );
    const manifest = await readManifest(resources);
    assert.ok(
      manifest.resources
        .find((entry) => entry.id === 'ffmpeg')
        ?.license.startsWith('GPL-2.0'),
    );
    for (const id of [
      'ffmpeg-source',
      'x264-source',
      'x265-source',
      'zlib-source',
    ])
      assert.ok(
        manifest.resources.some(
          (entry) => entry.id === id && entry.kind === 'source',
        ),
      );
    assert.ok(
      (
        await readFile(
          join(resources, 'media-tools/win32-x64/BUILD-INFO.txt'),
          'utf8',
        )
      ).includes('no GPU'),
    );
  },
);

windowsTest(
  'Windows packaged editor exports SDR H.264/HEVC and HLG/PQ Main10 offline, preserving text, timing, audio and restore',
  { timeout: 300000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor Windows \u00e9 '),
    );
    const profile = join(directory, 'profile');
    const destination = join(directory, 'export copies');
    const cases = [
      { name: 'SDR H264 \u00e9', codec: 'libx264', hdr: null },
      { name: 'SDR HEVC', codec: 'libx265', hdr: null },
      { name: 'HLG Main10', codec: 'libx265', hdr: 'arib-std-b67' },
      { name: 'PQ Main10', codec: 'libx265', hdr: 'smpte2084' },
    ] as const;
    const hashes = new Map<string, string>();
    const whitePixels = new Map<string, number[]>();
    try {
      await mkdir(profile);
      await mkdir(destination);
      await writeFile(
        join(profile, 'workspace.json'),
        JSON.stringify(
          SavedWorkspaceSchema.parse({
            version: 2,
            workspace: emptyWorkspace(),
            sources: {},
            outputFolder: destination,
          }),
        ),
      );
      for (const item of cases) {
        const path = join(directory, `${item.name}.mp4`);
        await run([
          '-f',
          'lavfi',
          '-i',
          item.hdr
            ? "nullsrc=s=1024x180:r=25:d=2,format=yuv420p10le,geq=lum='64+876*X/(W-1)':cb=512:cr=512"
            : 'testsrc2=s=320x180:r=25:d=2',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000:duration=2',
          '-c:v',
          item.codec,
          '-preset',
          'fast',
          '-b:v',
          '2M',
          '-bf',
          '0',
          ...(item.codec === 'libx265'
            ? [
                '-x265-params',
                item.hdr ? 'log-level=error:lossless=1' : 'log-level=error',
                '-tag:v',
                'hvc1',
              ]
            : []),
          '-pix_fmt',
          item.hdr ? 'yuv420p10le' : 'yuv420p',
          '-color_primaries',
          item.hdr ? 'bt2020' : 'bt709',
          '-color_trc',
          item.hdr ?? 'bt709',
          '-colorspace',
          item.hdr ? 'bt2020nc' : 'bt709',
          '-color_range',
          item.hdr === 'smpte2084' ? 'pc' : 'tv',
          '-c:a',
          'aac',
          '-ac',
          '2',
          '-shortest',
          path,
        ]);
        const fixture = await probeVideo(
          new MediaWorker(),
          ffprobe,
          path,
          new AbortController().signal,
        );
        t.diagnostic(
          JSON.stringify({
            fixture: item.name,
            video: fixture.streams.find(
              (stream) => stream.codec_type === 'video',
            ),
          }),
        );
        const fixtureAsset = describeVideo(
          fixture,
          '00000000-0000-4000-8000-000000000001',
          `${item.name}.mp4`,
        );
        assert.equal(
          fixtureAsset.colour.dynamicRange,
          item.hdr === 'arib-std-b67' ? 'hlg' : item.hdr ? 'pq' : 'sdr',
        );
        hashes.set(path, await digest(path));
      }
      await withPackagedApp(application, profile, async (page) => {
        await page
          .getByText('Bundled resources verified', { exact: true })
          .waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLInputElement>(
              'input[aria-label="Choose a video"]',
            )?.disabled === false,
        );
        await setNativeFiles(
          page,
          'input[aria-label="Choose a video"]',
          cases.map((item) => join(directory, `${item.name}.mp4`)),
        );
        await page.getByText('4 video(s) imported.', { exact: true }).waitFor();
        for (const [index, item] of cases.entries()) {
          await page
            .getByRole('button', { name: `Open ${item.name}.mp4`, exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Add text', exact: true })
            .click();
          const text = page.getByRole('textbox', {
            name: 'Video text',
            exact: true,
          });
          await text.fill('Windows \u{1f389}');
          await text.press('Control+Enter');
          await page
            .getByRole('spinbutton', { name: 'Font size', exact: true })
            .fill(item.hdr ? '48' : '18');
          await page
            .getByRole('spinbutton', { name: 'Font size', exact: true })
            .press('Tab');
          if (item.hdr)
            await page
              .getByRole('button', { name: 'Bold', exact: true })
              .click();
          for (const [label, value] of [
            ['X', '10'],
            ['Y', '3'],
          ] as const) {
            await page
              .getByRole('spinbutton', { name: label, exact: true })
              .fill(value);
            await page
              .getByRole('spinbutton', { name: label, exact: true })
              .press('Tab');
          }
          if (index === 0) {
            await page
              .getByRole('button', { name: 'Mute preview', exact: true })
              .click();
            await page
              .getByRole('button', { name: 'Play video', exact: true })
              .click();
            await page.waitForFunction(() => {
              const video = document.querySelector('video');
              return (
                video &&
                !video.paused &&
                video.readyState >= 2 &&
                video.currentTime > 0.15
              );
            });
            await page
              .getByRole('button', { name: 'Pause video', exact: true })
              .click();
          }
          const [, overlay] = await Promise.all([
            startCurrentExport(page, false),
            item.hdr ? waitForOverlay(destination) : Promise.resolve(null),
          ]);
          if (overlay) {
            const indices = await page.evaluate(async (base64) => {
              const image = new Image();
              image.src = `data:image/png;base64,${base64}`;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext('2d');
              if (!context)
                throw new Error('The overlay pixel canvas is unavailable.');
              context.drawImage(image, 0, 0);
              const rgba = context.getImageData(
                0,
                0,
                image.width,
                image.height,
              ).data;
              const indices: number[] = [];
              for (let y = 2; y < image.height - 2; y++)
                for (let x = 2; x < image.width - 2; x++) {
                  const pixel = (y * image.width + x) * 4;
                  if (
                    rgba[pixel]! < 254 ||
                    rgba[pixel + 1]! < 254 ||
                    rgba[pixel + 2]! < 254
                  )
                    continue;
                  let interior = true;
                  for (let dy = -2; dy <= 2; dy++)
                    for (let dx = -2; dx <= 2; dx++)
                      if (
                        rgba[((y + dy) * image.width + x + dx) * 4 + 3]! < 254
                      )
                        interior = false;
                  if (interior) indices.push(y * image.width + x);
                }
              return indices;
            }, overlay.toString('base64'));
            assert.ok(
              indices.length > 50,
              `${item.name}: opaque white glyph interiors required`,
            );
            whitePixels.set(item.name, indices);
          }
          await finishCurrentExport(page, 60000);
        }
        await page.getByText('Saved Locally', { exact: true }).waitFor();
      });
      for (const item of cases) {
        const source = join(directory, `${item.name}.mp4`);
        const output = join(destination, `${item.name}_edited.mp4`);
        const worker = new MediaWorker();
        const signal = new AbortController().signal;
        const before = await probeVideo(worker, ffprobe, source, signal, {
          countFrames: true,
        });
        const after = await probeVideo(worker, ffprobe, output, signal, {
          countFrames: true,
        });
        const asset = describeVideo(
          before,
          '00000000-0000-4000-8000-000000000001',
          `${item.name}.mp4`,
        );
        validateOutput(before, after, asset);
        if (item.hdr) await validateHdrFrames(worker, ffprobe, output, signal);
        const packets = async (file: string) => {
          const result = await execute(
            ffprobe,
            [
              '-v',
              'error',
              '-select_streams',
              'a',
              '-show_packets',
              '-show_data_hash',
              'sha256',
              '-show_entries',
              'packet=data_hash',
              '-of',
              'json',
              file,
            ],
            { windowsHide: true },
          );
          return z
            .object({ packets: z.array(z.object({ data_hash: z.string() })) })
            .parse(JSON.parse(result.stdout)).packets;
        };
        assert.deepEqual(await packets(output), await packets(source));
        const times = async (file: string) => {
          const result = await execute(
            ffprobe,
            [
              '-v',
              'error',
              '-select_streams',
              'v',
              '-show_frames',
              '-show_entries',
              'frame=best_effort_timestamp_time',
              '-of',
              'json',
              file,
            ],
            { windowsHide: true },
          );
          return z
            .object({
              frames: z.array(
                z.object({ best_effort_timestamp_time: z.string() }),
              ),
            })
            .parse(JSON.parse(result.stdout))
            .frames.map((frame) => Number(frame.best_effort_timestamp_time));
        };
        const inputTimes = await times(source);
        const outputTimes = await times(output);
        assert.equal(inputTimes.length, 50);
        assert.equal(outputTimes.length, inputTimes.length);
        inputTimes.forEach((value, index) =>
          assert.ok(Math.abs(value - outputTimes[index]!) <= 0.000002),
        );
        const quality = await execute(
          ffmpeg,
          [
            '-nostdin',
            '-v',
            'info',
            '-i',
            source,
            '-i',
            output,
            '-filter_complex',
            '[0:v]crop=iw:ih/2:0:ih/2,setpts=PTS-STARTPTS[a];[1:v]crop=iw:ih/2:0:ih/2,setpts=PTS-STARTPTS[b];[a][b]psnr',
            '-an',
            '-f',
            'null',
            '-',
          ],
          { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        );
        const psnr = /average:([\d.]+|inf)/.exec(quality.stderr)?.[1];
        assert.ok(
          psnr && (psnr === 'inf' || Number(psnr) >= 42),
          `${item.name} non-text PSNR: ${psnr}`,
        );
        const pixels = async (path: string) => {
          const result = await execute(
            ffmpeg,
            [
              '-nostdin',
              '-v',
              'error',
              '-i',
              path,
              '-frames:v',
              '1',
              '-vf',
              'format=rgb24',
              '-f',
              'rawvideo',
              'pipe:1',
            ],
            {
              windowsHide: true,
              encoding: 'buffer',
              maxBuffer: 4 * 1024 * 1024,
            },
          );
          return result.stdout;
        };
        const original = await pixels(source);
        const edited = await pixels(output);
        const width = item.hdr ? 1024 : 320;
        let changed = 0;
        for (let offset = 0; offset < width * 60 * 3; offset += 3)
          if (Math.abs(original[offset]! - edited[offset]!) > 30) changed++;
        assert.ok(
          changed > 30,
          `${item.name} must contain visible rendered text`,
        );
        assert.equal(await digest(source), hashes.get(source));
        if (item.hdr) {
          const decodeFrame = async (file: string) =>
            execute(
              ffmpeg,
              [
                '-nostdin',
                '-v',
                'error',
                '-i',
                file,
                '-frames:v',
                '1',
                '-pix_fmt',
                'yuv420p10le',
                '-f',
                'rawvideo',
                'pipe:1',
              ],
              {
                windowsHide: true,
                encoding: 'buffer',
                maxBuffer: 4 * 1024 * 1024,
              },
            );
          const [originalFrame, decoded] = await Promise.all([
            decodeFrame(source),
            decodeFrame(output),
          ]);
          const levels = new Set<number>();
          let nonTextError = 0;
          for (let x = 0; x < width; x++) {
            const offset = (150 * width + x) * 2;
            const value = decoded.stdout.readUInt16LE(offset);
            levels.add(value);
            nonTextError += Math.abs(
              value - originalFrame.stdout.readUInt16LE(offset),
            );
          }
          nonTextError /= width;
          assert.ok(
            nonTextError < 2,
            `${item.name}: non-text ten-bit error ${nonTextError}`,
          );
          assert.ok(
            levels.size > 700,
            `${item.name}: only ${levels.size} gradient levels`,
          );
          const indices = whitePixels.get(item.name);
          assert.ok(indices && indices.length > 50);
          const whiteCode =
            item.hdr === 'smpte2084' ? 1023 * 0.580689 : 64 + 876 * 0.74988;
          const whiteError =
            indices.reduce(
              (sum, index) =>
                sum +
                Math.abs(decoded.stdout.readUInt16LE(index * 2) - whiteCode),
              0,
            ) / indices.length;
          assert.ok(
            whiteError < 3,
            `${item.name}: glyph-white error ${whiteError}`,
          );
          t.diagnostic(
            JSON.stringify({
              sample: item.name,
              gradientLevels: levels.size,
              nonTextError,
              whiteSamples: indices.length,
              whiteError,
            }),
          );
        }
        t.diagnostic(
          `${item.name}: 50 displayed frames, unchanged timestamps/AAC/source; non-text PSNR ${psnr} dB.`,
        );
      }
      assert.equal(
        (await readdir(destination)).filter((name) =>
          name.startsWith('.video-text-editor-'),
        ).length,
        0,
      );
      await withPackagedApp(application, profile, async (page) => {
        await page
          .getByText('Bundled resources verified', { exact: true })
          .waitFor();
        await page
          .getByRole('button', { name: 'Open PQ Main10.mp4', exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Video text', exact: true })
            .inputValue(),
          'Windows \u{1f389}',
        );
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
