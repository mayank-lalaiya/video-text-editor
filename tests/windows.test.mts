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
  async () => {
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
          'testsrc2=s=320x180:r=25:d=2',
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
            ? ['-x265-params', 'log-level=error', '-tag:v', 'hvc1']
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
          'tv',
          '-c:a',
          'aac',
          '-ac',
          '2',
          '-shortest',
          path,
        ]);
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
            .fill('18');
          await page
            .getByRole('spinbutton', { name: 'Font size', exact: true })
            .press('Tab');
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
          await startCurrentExport(page, false);
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
        let changed = 0;
        for (let offset = 0; offset < 320 * 60 * 3; offset += 3)
          if (Math.abs(original[offset]! - edited[offset]!) > 30) changed++;
        assert.ok(
          changed > 30,
          `${item.name} must contain visible rendered text`,
        );
        assert.equal(await digest(source), hashes.get(source));
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
