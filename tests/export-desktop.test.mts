import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  _electron,
  type ElectronApplication,
  type Page,
} from 'playwright-core';
import {
  QueueResultSchema,
  type ExportScope,
} from '../src/shared/export-queue.ts';
import type {} from '../src/renderer/environment.d.ts';
import { acknowledgeCancellation } from './export-helpers.mts';

const root = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);
const electron = createRequire(import.meta.url)('electron') as string;
const ffmpeg = join(root, 'resources/media-tools/darwin-arm64/ffmpeg');
const ffprobe = join(root, 'resources/media-tools/darwin-arm64/ffprobe');
declare global {
  var exportTestGate:
    | { entered: boolean; path: string | null; release: (() => void) | null }
    | undefined;
  var exportCloseCalls: number | undefined;
}
async function fixture(path: string, hdr = false) {
  await execute(ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=640x360:r=10:d=2${hdr ? ',format=p010le' : ''}`,
    '-c:v',
    hdr ? 'hevc_videotoolbox' : 'h264_videotoolbox',
    ...(hdr
      ? [
          '-profile:v',
          'main10',
          '-pix_fmt',
          'p010le',
          '-bsf:v',
          'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9:video_full_range_flag=0',
          '-tag:v',
          'hvc1',
        ]
      : []),
    path,
  ]);
}
async function state(page: Page) {
  const result = QueueResultSchema.parse(
    await page.evaluate(() => window.desktop!.exportQueue({ type: 'status' })),
  );
  assert.ok(result.ok);
  assert.ok(result.state);
  return result.state;
}
async function setText(page: Page, name: string, text: string) {
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  if (
    await page.getByRole('textbox', { name: 'Video text', exact: true }).count()
  )
    await page
      .getByRole('group', { name: 'Text box controls', exact: true })
      .dblclick();
  else
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Video text', exact: true });
  await input.fill(text);
  await input.press('Meta+Enter');
}
async function preflight(page: Page, scope: ExportScope) {
  if (scope === 'current')
    await page
      .getByRole('button', { name: 'Export current', exact: true })
      .click();
  else {
    await page
      .getByRole('button', { name: 'Export batch', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: scope === 'all' ? /^Export all \(/ : /^Export checked \(/,
      })
      .click();
  }
  await page
    .getByRole('dialog', { name: 'Export preflight', exact: true })
    .waitFor();
}
async function results(page: Page) {
  await page
    .getByRole('dialog', { name: 'Export results', exact: true })
    .waitFor({ timeout: 60000 });
  return await state(page);
}
async function chooseFolder(page: Page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Choose folder', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('.export-dialog button'),
      ).find((button) => button.textContent === 'Choose folder')?.disabled ===
      false,
  );
}
async function withQueue(
  run: (
    page: Page,
    app: ElectronApplication,
    directory: string,
    output: string,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'video-editor-batch-'));
  const output = join(directory, 'exports');
  await mkdir(output);
  let app: ElectronApplication | undefined;
  let child: ReturnType<ElectronApplication['process']> | undefined;
  try {
    app = await _electron.launch({
      executablePath: electron,
      args: [root, `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VIDEO_EDITOR_TEST_BACKGROUND: '1' },
    });
    child = app.process();
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, output) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [output],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, output);
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    await page.getByText('Saved Locally', { exact: true }).waitFor();
    await run(page, app, directory, output);
    if (child.exitCode === null && child.signalCode === null)
      assert.ok(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => !window.isVisible() && !window.isFocused(),
          ),
        ),
      );
  } finally {
    if (app && child && child.exitCode === null && child.signalCode === null) {
      await app.evaluate(({ dialog }) => {
        globalThis.exportTestGate?.release?.();
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await app.close();
    }
    await rm(directory, { recursive: true });
  }
}
async function gate(
  app: ElectronApplication,
  point: 'overlay' | 'validation' | 'cleanup' | 'journal',
  source: string,
) {
  await app.evaluate(
    async (_electron, { point, source }) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      const canonical = await fs.realpath(source);
      const gate = {
        entered: false,
        path: null as string | null,
        release: null as (() => void) | null,
      };
      globalThis.exportTestGate = gate;
      let matched = 0;
      const pause = async (path: string) => {
        gate.entered = true;
        gate.path = path;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Export test gate timed out.')),
            30000,
          );
          gate.release = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      };
      if (point === 'overlay') {
        const original = fs.writeFile;
        fs.writeFile = async (...args) => {
          if (
            typeof args[0] === 'string' &&
            args[0].endsWith('/text.png') &&
            ++matched === 2
          ) {
            fs.writeFile = original;
            await pause(args[0]);
          }
          return original(...args);
        };
      } else if (point === 'validation') {
        const original = fs.stat;
        fs.stat = new Proxy(original, {
          apply: async (
            target,
            _receiver,
            args: Parameters<typeof original>,
          ) => {
            if (args[0] === canonical && ++matched === 2) {
              fs.stat = original;
              await pause(canonical);
            }
            return target(...args);
          },
        });
      } else if (point === 'cleanup') {
        const original = fs.rm;
        fs.rm = async (...args) => {
          if (
            typeof args[0] === 'string' &&
            args[0].includes('/exports/.video-text-editor-') &&
            !args[0].includes('.video-text-editor-check-') &&
            ++matched === 2
          ) {
            fs.rm = original;
            await pause(args[0]);
          }
          return original(...args);
        };
      } else {
        const original = fs.rename;
        fs.rename = async (...args) => {
          if (
            typeof args[1] === 'string' &&
            args[1].endsWith('/export-session.json')
          ) {
            const record = JSON.parse(await fs.readFile(args[0], 'utf8')) as {
              status: string;
            };
            if (record.status === 'finished') {
              fs.rename = original;
              await pause(String(args[0]));
            }
          }
          return original(...args);
        };
      }
    },
    { point, source },
  );
}
async function waitForGate(app: ElectronApplication) {
  await app.evaluate(async () => {
    const start = Date.now();
    while (!globalThis.exportTestGate?.entered) {
      if (Date.now() - start > 10000)
        throw new Error('Export gate was not reached.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
}
async function threeClips(page: Page, directory: string) {
  const paths = ['first', 'second', 'third'].map((name) =>
    join(directory, `${name}.mp4`),
  );
  for (const path of paths) await fixture(path);
  await page.getByLabel('Choose a video').setInputFiles(paths);
  await page.getByText('3 video(s) imported.', { exact: true }).waitFor();
  await setText(page, 'first.mp4', 'Batch text');
  await page.getByRole('button', { name: 'Apply to all', exact: true }).click();
  return paths;
}

test(
  'hidden batch preflight separates scopes/exclusions and exports duplicate SDR/HDR names without overwriting late collisions',
  { timeout: 90000 },
  async () => {
    await withQueue(async (page, _app, directory, output) => {
      await mkdir(join(directory, 'sdr'));
      await mkdir(join(directory, 'hdr'));
      const sdr = join(directory, 'sdr/clip.mp4');
      const hdr = join(directory, 'hdr/clip.mp4');
      const blank = join(directory, 'blank.mp4');
      const missing = join(directory, 'missing.mp4');
      for (const [path, isHdr] of [
        [sdr, false],
        [hdr, true],
        [blank, false],
        [missing, false],
      ] as const)
        await fixture(path, isHdr);
      const hashes = await Promise.all(
        [sdr, hdr].map(async (path) =>
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        ),
      );
      await page
        .getByLabel('Choose a video')
        .setInputFiles([sdr, hdr, blank, missing]);
      await page.getByText('4 video(s) imported.', { exact: true }).waitFor();
      await page
        .getByRole('button', { name: 'Open clip.mp4', exact: true })
        .first()
        .click();
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .fill('Batch glyph');
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .press('Meta+Enter');
      await page
        .getByRole('button', { name: 'Apply to all', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Open blank.mp4', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Delete text', exact: true })
        .click();
      await rename(missing, join(directory, 'moved.mp4'));
      await preflight(page, 'current');
      assert.deepEqual(
        (await state(page)).jobs.map((job) => job.status),
        ['skipped'],
      );
      assert.ok(
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .isDisabled(),
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page
        .getByRole('checkbox', { name: 'Select all for export', exact: true })
        .check();
      await page
        .getByRole('checkbox', { name: 'Export clip.mp4', exact: true })
        .first()
        .uncheck();
      await preflight(page, 'checked');
      assert.deepEqual(
        (await state(page)).jobs.map((job) => job.status),
        ['ready', 'skipped', 'blocked'],
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await writeFile(join(output, 'clip_edited.mp4'), 'existing');
      await preflight(page, 'all');
      await chooseFolder(page);
      assert.deepEqual(
        (await state(page)).jobs.map((job) => job.status),
        ['ready', 'ready', 'skipped', 'blocked'],
      );
      assert.deepEqual(
        (await state(page)).jobs.slice(0, 2).map((job) => job.filename),
        ['clip_edited_2.mp4', 'clip_edited_3.mp4'],
      );
      await writeFile(join(output, 'clip_edited_2.mp4'), 'late collision');
      await page
        .getByRole('button', { name: 'Start export', exact: true })
        .click();
      const result = await results(page);
      assert.deepEqual(
        result.jobs.map((job) => job.status),
        ['completed', 'completed', 'skipped', 'blocked'],
      );
      assert.deepEqual(
        result.jobs.slice(0, 2).map((job) => job.path),
        [join(output, 'clip_edited_3.mp4'), join(output, 'clip_edited_4.mp4')],
      );
      for (const [index, codec] of ['h264', 'hevc'].entries()) {
        const { stdout } = await execute(ffprobe, [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=codec_name,width,height,color_transfer',
          '-of',
          'json',
          result.jobs[index]!.path!,
        ]);
        const stream = JSON.parse(stdout).streams[0] as {
          codec_name: string;
          width: number;
          height: number;
          color_transfer?: string;
        };
        assert.equal(stream.codec_name, codec);
        assert.equal(stream.width, 640);
        assert.equal(stream.height, 360);
        if (index === 1) assert.equal(stream.color_transfer, 'arib-std-b67');
      }
      assert.equal(
        await readFile(join(output, 'clip_edited.mp4'), 'utf8'),
        'existing',
      );
      assert.equal(
        await readFile(join(output, 'clip_edited_2.mp4'), 'utf8'),
        'late collision',
      );
      assert.deepEqual(
        await Promise.all(
          [sdr, hdr].map(async (path) =>
            createHash('sha256')
              .update(await readFile(path))
              .digest('hex'),
          ),
        ),
        hashes,
      );
      assert.ok(!(await readdir(output)).some((name) => name.startsWith('.')));
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      assert.ok(
        !(await page
          .getByRole('button', { name: 'Export current', exact: true })
          .isDisabled()),
      );
    });
  },
);

test(
  'hidden queue reports destination failures, continues after one failure, retries current text only and preserves published output on cleanup failure',
  { timeout: 90000 },
  async () => {
    await withQueue(async (page, app, directory, output) => {
      await threeClips(page, directory);
      await preflight(page, 'all');
      await app.evaluate(() => {
        const fs = process.getBuiltinModule('node:fs/promises');
        const original = fs.statfs;
        fs.statfs = new Proxy(original, {
          apply: async (
            target,
            _receiver,
            args: Parameters<typeof original>,
          ) => {
            fs.statfs = original;
            const result = await target(...args);
            result.bavail = typeof result.bavail === 'bigint' ? 0n : 0;
            return result;
          },
        });
      });
      await chooseFolder(page);
      await page
        .getByRole('alert')
        .filter({ hasText: 'Insufficient free space' })
        .waitFor();
      assert.ok(
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .isDisabled(),
      );
      await app.evaluate(() => {
        const fs = process.getBuiltinModule('node:fs/promises');
        const original = fs.open;
        fs.open = async (...args) => {
          if (
            typeof args[0] === 'string' &&
            args[0].includes('.video-text-editor-check-')
          ) {
            fs.open = original;
            throw Object.assign(new Error('Simulated permission denied'), {
              code: 'EACCES',
            });
          }
          return original(...args);
        };
      });
      await chooseFolder(page);
      await page
        .getByRole('alert')
        .filter({ hasText: 'Simulated permission denied' })
        .waitFor();
      assert.ok(
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .isDisabled(),
      );
      await chooseFolder(page);
      await app.evaluate(() => {
        const fs = process.getBuiltinModule('node:fs/promises');
        const original = fs.writeFile;
        fs.writeFile = async (...args) => {
          if (typeof args[0] === 'string' && args[0].endsWith('/text.png')) {
            fs.writeFile = original;
            throw new Error('Simulated first job failure');
          }
          return original(...args);
        };
      });
      await page
        .getByRole('button', { name: 'Start export', exact: true })
        .click();
      assert.deepEqual(
        (await results(page)).jobs.map((job) => job.status),
        ['failed', 'completed', 'completed'],
      );
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await setText(page, 'first.mp4', 'Changed for retry');
      await page
        .getByRole('button', { name: 'Review export results', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Retry failed', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: 'Export preflight', exact: true })
        .waitFor();
      const plan = await state(page);
      assert.equal(plan.jobs.length, 1);
      assert.equal(plan.jobs[0]!.textBox!.text, 'Changed for retry');
      await app.evaluate(() => {
        const fs = process.getBuiltinModule('node:fs/promises');
        const original = fs.rm;
        fs.rm = async (...args) => {
          if (
            typeof args[0] === 'string' &&
            args[0].includes('/exports/.video-text-editor-')
          ) {
            fs.rm = original;
            throw new Error('Simulated final cleanup failure');
          }
          return original(...args);
        };
      });
      await gate(app, 'journal', join(directory, 'first.mp4'));
      await page
        .getByRole('button', { name: 'Start export', exact: true })
        .click();
      await waitForGate(app);
      assert.equal((await state(page)).status, 'running');
      assert.ok(
        await page
          .getByRole('spinbutton', { name: 'Font size', exact: true })
          .isDisabled(),
      );
      await app.evaluate(() => globalThis.exportTestGate?.release?.());
      const result = await results(page);
      assert.equal(result.jobs[0]!.status, 'completed');
      assert.match(
        result.jobs[0]!.error!,
        /Temporary export files could not be removed:.*\.video-text-editor-/,
      );
      assert.ok((await readFile(result.jobs[0]!.path!)).length > 100);
      assert.equal(
        (await readdir(output)).filter((name) => name.endsWith('.mp4')).length,
        3,
      );
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page
        .getByRole('alert')
        .filter({ hasText: result.jobs[0]!.temporaryPath! })
        .waitFor({ timeout: 1500 });
      await setText(page, 'first.mp4', 'Changed after export');
      await page
        .getByRole('alert')
        .filter({ hasText: result.jobs[0]!.temporaryPath! })
        .waitFor({ timeout: 1500 });
      assert.match(
        await page
          .getByRole('button', { name: 'Open first.mp4', exact: true })
          .innerText(),
        /Changed since export/,
      );
    });
  },
);

test(
  'results modal blocks keyboard history until Done, then ordinary undo works',
  { timeout: 30000 },
  async () => {
    await withQueue(async (page, _app, directory) => {
      await threeClips(page, directory);
      await setText(page, 'first.mp4', 'Keep me after export');
      await preflight(page, 'current');
      await chooseFolder(page);
      await page
        .getByRole('button', { name: 'Start export', exact: true })
        .click();
      await results(page);
      const input = page.getByRole('textbox', {
        name: 'Video text',
        exact: true,
      });
      const before = await input.inputValue();
      await page.keyboard.press('Meta+z');
      assert.equal(
        await input.inputValue(),
        before,
        'Undo must not edit the video behind a modal.',
      );
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.notEqual(await input.inputValue(), before);
    });
  },
);

test(
  'closing and reopening restores preflight and rejects a late folder selection from the closed window',
  { timeout: 30000 },
  async () => {
    await withQueue(async (page, app, directory, output) => {
      await threeClips(page, directory);
      await preflight(page, 'all');
      const id = (await state(page)).id;
      await app.evaluate(({ dialog }, output) => {
        dialog.showOpenDialog = () =>
          new Promise((resolve) => {
            globalThis.exportTestGate = {
              entered: true,
              path: null,
              release: () => resolve({ canceled: false, filePaths: [output] }),
            };
          });
      }, output);
      await page
        .getByRole('button', { name: 'Choose folder', exact: true })
        .click();
      await waitForGate(app);
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.close(),
      );
      await closed;
      const opened = app.waitForEvent('window');
      await app.evaluate(({ app }) => app.emit('activate'));
      const restored = await opened;
      await restored.getByText('Saved Locally', { exact: true }).waitFor();
      await restored
        .getByRole('dialog', { name: 'Export preflight', exact: true })
        .waitFor({ timeout: 1500 });
      assert.equal((await state(restored)).id, id);
      await app.evaluate(() => globalThis.exportTestGate?.release?.());
      assert.equal(
        (await state(restored)).folder,
        null,
        'A closed window must not change the reopened preflight destination.',
      );
      await restored
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await restored.getByRole('dialog').waitFor({ state: 'hidden' });
      await restored
        .getByRole('button', { name: 'Import videos', exact: true })
        .first()
        .click({ trial: true });
      assert.ok(
        !(await restored
          .getByRole('button', { name: 'Import videos', exact: true })
          .first()
          .isDisabled()),
      );
    });
  },
);

for (const mode of ['cancel', 'deadline'] as const) {
  test(
    `stalled overlay conversion respects ${mode} and releases its window and queue`,
    { timeout: 35000 },
    async () => {
      await withQueue(async (page, app, directory, output) => {
        await threeClips(page, directory);
        await preflight(page, 'all');
        await chooseFolder(page);
        await app.evaluate(({ app }) => {
          app.once('web-contents-created', (_event, contents) => {
            const original = contents.executeJavaScript.bind(contents);
            contents.executeJavaScript = (_code, userGesture) => {
              contents.executeJavaScript = original;
              globalThis.exportTestGate = {
                entered: true,
                path: null,
                release: () => {
                  if (!contents.isDestroyed())
                    void original('window.releaseExportConversion?.()').catch(
                      (error: unknown) =>
                        console.error('Test overlay release failed.', error),
                    );
                },
              };
              return original(
                'new Promise(resolve => { window.releaseExportConversion = () => resolve(""); })',
                userGesture,
              );
            };
          });
        });
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .click();
        await waitForGate(app);
        try {
          if (mode === 'cancel') {
            const acknowledgementMs = await acknowledgeCancellation(page);
            assert.ok(
              acknowledgementMs <= 250,
              `Cancellation acknowledgement: ${acknowledgementMs}ms`,
            );
          }
          await page
            .getByRole('dialog', { name: 'Export results', exact: true })
            .waitFor({ timeout: mode === 'cancel' ? 2000 : 24000 });
          const result = await state(page);
          assert.deepEqual(
            result.jobs.map((job) => job.status),
            mode === 'cancel'
              ? ['cancelled', 'cancelled', 'cancelled']
              : ['failed', 'completed', 'completed'],
          );
          if (mode === 'deadline')
            assert.match(result.jobs[0]!.error!, /20 seconds/);
          assert.equal(
            (await readdir(output)).filter((name) => name.startsWith('.'))
              .length,
            0,
          );
          assert.equal(
            await app.evaluate(
              ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
            ),
            1,
          );
        } finally {
          await app.evaluate(() => globalThis.exportTestGate?.release?.());
        }
      });
    },
  );
}

test(
  'preflight rejects a writable destination that cannot publish with hard links',
  { timeout: 30000 },
  async () => {
    await withQueue(async (page, app, directory, output) => {
      await threeClips(page, directory);
      await preflight(page, 'all');
      await app.evaluate(() => {
        const fs = process.getBuiltinModule('node:fs/promises');
        const original = fs.link;
        fs.link = async (...args) => {
          if (
            typeof args[0] === 'string' &&
            args[0].includes('.video-text-editor-check-')
          ) {
            fs.link = original;
            throw Object.assign(
              new Error('Simulated filesystem without hard links'),
              { code: 'ENOTSUP' },
            );
          }
          return original(...args);
        };
      });
      await chooseFolder(page);
      await page
        .getByRole('alert')
        .filter({ hasText: 'hard links' })
        .waitFor({ timeout: 1500 });
      assert.ok(
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .isDisabled(),
      );
      assert.deepEqual(await readdir(output), []);
    });
  },
);

for (const point of ['overlay', 'validation', 'cleanup'] as const) {
  test(
    `hidden cancellation during ${point} waits for writers and preserves completed outputs`,
    { timeout: 60000 },
    async () => {
      await withQueue(async (page, app, directory, output) => {
        const paths = await threeClips(page, directory);
        await preflight(page, 'all');
        await chooseFolder(page);
        await gate(app, point, paths[1]!);
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .click();
        await waitForGate(app);
        const cancelling = performance.now();
        const acknowledgementMs = await acknowledgeCancellation(page);
        assert.ok(
          acknowledgementMs <= 250,
          `Cancellation acknowledgement: ${acknowledgementMs}ms`,
        );
        await page
          .getByRole('dialog', { name: 'Stopping export...', exact: true })
          .waitFor();
        assert.ok(
          await page
            .getByRole('button', { name: 'Cancel export', exact: true })
            .isDisabled(),
        );
        assert.ok(
          await page
            .getByRole('button', { name: 'Apply to all', exact: true })
            .isDisabled(),
        );
        await app.evaluate(() => globalThis.exportTestGate?.release?.());
        const result = await results(page);
        const stopMs = performance.now() - cancelling;
        assert.ok(stopMs <= 5000, `Cancellation stop: ${stopMs}ms`);
        console.log(
          `${point} cancellation timing:`,
          JSON.stringify({ acknowledgementMs, stopMs }),
        );
        assert.deepEqual(
          result.jobs.map((job) => job.status),
          point === 'cleanup'
            ? ['completed', 'completed', 'cancelled']
            : ['completed', 'cancelled', 'cancelled'],
        );
        assert.equal(
          (await readdir(output)).length,
          point === 'cleanup' ? 2 : 1,
        );
        assert.ok(
          (await readdir(output)).every((name) => name.endsWith('.mp4')),
        );
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        assert.ok(
          !(await page
            .getByRole('button', { name: 'Apply to all', exact: true })
            .isDisabled()),
        );
      });
    },
  );
}

test(
  'hidden close can continue exporting, then Cancel and Quit waits and records completed/cancelled jobs',
  { timeout: 60000 },
  async () => {
    await withQueue(async (page, app, directory, output) => {
      const child = app.process();
      const paths = await threeClips(page, directory);
      await preflight(page, 'all');
      await chooseFolder(page);
      await gate(app, 'overlay', paths[1]!);
      await page
        .getByRole('button', { name: 'Start export', exact: true })
        .click();
      await waitForGate(app);
      await app.evaluate(({ BrowserWindow, dialog }) => {
        globalThis.exportCloseCalls = 0;
        dialog.showMessageBox = async () => {
          globalThis.exportCloseCalls = (globalThis.exportCloseCalls ?? 0) + 1;
          return { response: 0, checkboxChecked: false };
        };
        BrowserWindow.getAllWindows()
          .find(
            (window) => !window.webContents.getURL().includes('view=overlay'),
          )!
          .close();
      });
      assert.equal(await app.evaluate(() => globalThis.exportCloseCalls), 1);
      assert.equal((await state(page)).status, 'running');
      await app.evaluate(({ BrowserWindow, dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
        setTimeout(() => {
          globalThis.exportTestGate?.release?.();
        }, 100);
        setTimeout(
          () =>
            BrowserWindow.getAllWindows()
              .find(
                (window) =>
                  !window.webContents.getURL().includes('view=overlay'),
              )!
              .close(),
          10,
        );
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Cancel and Quit did not finish.')),
          10000,
        );
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const result = JSON.parse(
        await readFile(join(directory, 'profile/export-session.json'), 'utf8'),
      ) as { status: string; jobs: { status: string }[] };
      assert.equal(result.status, 'finished');
      assert.deepEqual(
        result.jobs.map((job) => job.status),
        ['completed', 'cancelled', 'cancelled'],
      );
      assert.deepEqual(await readdir(output), ['first_edited.mp4']);
    });
  },
);
