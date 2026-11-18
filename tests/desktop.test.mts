import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Page } from 'playwright-core';
import { readManifest } from '../src/main/resources/manifest.ts';
import { SavedWorkspaceSchema } from '../src/main/workspace/store.ts';
import { QueueResultSchema } from '../src/shared/export-queue.ts';
import { finishCurrentExport } from './export-helpers.mts';
import { z } from 'zod';
import { withPackagedApp, setNativeFiles } from './packaged-app.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle =
  process.env.VIDEO_EDITOR_PACKAGED_APP ??
  join(root, 'out/Video Text Editor-darwin-arm64/Video Text Editor.app');

async function waitForStatus(page: Page, title: string) {
  await page
    .getByText(title, { exact: true })
    .waitFor({ timeout: 30000 })
    .catch(async (error: unknown) => {
      throw new Error(
        `${String(error)}\n${await page.locator('body').innerText()}`,
      );
    });
}

test(
  'relocated hardened app edits, plays, exports and restores offline with no developer PATH or Node inspection',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-packaged-workspace-'),
    );
    const profile = join(directory, 'profile');
    const first = join(directory, 'first.mp4');
    const second = join(directory, 'second.mp4');
    const third = join(directory, 'third.mp4');
    const moved = join(directory, 'moved.mp4');
    const portable = join(directory, 'Portable Review.app');
    const destination = join(directory, 'exports');
    const text = 'Saved inside the actual packaged app \u{1f389}';
    try {
      await cp(bundle, portable, { recursive: true, verbatimSymlinks: true });
      await mkdir(destination);
      await promisify(execFile)(
        join(root, 'resources/media-tools/darwin-arm64/ffmpeg'),
        [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=s=320x180:r=25:d=2',
          '-c:v',
          'h264_videotoolbox',
          first,
        ],
      );
      await copyFile(first, second);
      await copyFile(first, third);
      await withPackagedApp(portable, profile, async (page) => {
        await waitForStatus(page, 'Bundled resources verified');
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLInputElement>(
              'input[aria-label="Choose a video"]',
            )?.disabled === false,
        );
        await setNativeFiles(page, 'input[aria-label="Choose a video"]', [
          first,
          second,
        ]);
        await page.getByText('2 video(s) imported.', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await input.fill(text);
        await input.press('Meta+Enter');
        await page.getByLabel('Export second.mp4', { exact: true }).check();
        assert.equal(
          await page
            .locator('.video-card[aria-current="true"] strong')
            .innerText(),
          'first.mp4',
        );
        await page
          .getByRole('button', { name: 'Open second.mp4', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        await input.fill('Independent packaged text');
        await input.press('Meta+Enter');
        await page
          .getByRole('button', { name: 'Open first.mp4', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Apply to all', exact: true })
          .click();
        assert.equal(
          await page.getByLabel('Auto-apply to new imports').isChecked(),
          true,
        );
        await page.getByText('Saved Locally', { exact: true }).waitFor();
      });
      await rename(first, moved);
      const savedPath = join(profile, 'workspace.json');
      const previous = SavedWorkspaceSchema.parse(
        JSON.parse(await readFile(savedPath, 'utf8')),
      );
      await writeFile(
        savedPath,
        JSON.stringify({ ...previous, outputFolder: destination }),
      );
      await withPackagedApp(portable, profile, async (page) => {
        await page
          .getByRole('alert')
          .filter({ hasText: 'Source unavailable' })
          .waitFor();
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Video text', exact: true })
            .inputValue(),
          text,
        );
        await setNativeFiles(page, 'input[aria-label="Locate first.mp4"]', [
          moved,
        ]);
        await page
          .getByRole('button', { name: 'Open moved.mp4', exact: true })
          .waitFor();
        await page
          .getByRole('button', { name: 'Open second.mp4', exact: true })
          .click();
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Video text', exact: true })
            .inputValue(),
          'Independent packaged text',
        );
        assert.equal(
          await page
            .getByLabel('Export second.mp4', { exact: true })
            .isChecked(),
          true,
        );
        assert.equal(
          await page.getByLabel('Auto-apply to new imports').isChecked(),
          true,
        );
        await setNativeFiles(page, 'input[aria-label="Choose a video"]', [
          third,
        ]);
        await page.getByText('1 video(s) imported.', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Open third.mp4', exact: true })
          .click();
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Video text', exact: true })
            .inputValue(),
          text,
        );
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .click();
        await page.waitForFunction(() => {
          const video = document.querySelector('video');
          return video && video.readyState >= 2 && video.currentTime > 0;
        });
        await page
          .getByRole('button', { name: 'Export current', exact: true })
          .click();
        await page
          .getByRole('dialog', { name: 'Export preflight', exact: true })
          .waitFor();
        await page
          .getByRole('button', { name: 'Start export', exact: true })
          .click();
        await finishCurrentExport(page);
        const result = QueueResultSchema.parse(
          await page.evaluate(() =>
            window.desktop!.exportQueue({ type: 'status' }),
          ),
        );
        assert.ok(result.ok && result.state);
        assert.equal(result.state.jobs[0]?.status, 'completed');
        assert.equal(
          result.state.jobs[0]?.path,
          join(destination, 'third_edited.mp4'),
        );
        const { stdout } = await promisify(execFile)(
          join(
            portable,
            'Contents/Resources/resources/media-tools/darwin-arm64/ffprobe',
          ),
          [
            '-v',
            'error',
            '-show_streams',
            '-show_format',
            '-of',
            'json',
            join(destination, 'third_edited.mp4'),
          ],
        );
        const encoded = z
          .object({
            streams: z.array(
              z.object({
                codec_name: z.string(),
                width: z.number(),
                height: z.number(),
              }),
            ),
            format: z.object({ duration: z.coerce.number() }),
          })
          .parse(JSON.parse(stdout));
        assert.deepEqual(encoded.streams, [
          { codec_name: 'h264', width: 320, height: 180 },
        ]);
        assert.ok(Math.abs(encoded.format.duration - 2) <= 1 / 25);
        await page.getByText('Saved Locally', { exact: true }).waitFor();
      });
      await withPackagedApp(portable, profile, async (page) => {
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole('textbox', { name: 'Video text', exact: true })
            .inputValue(),
          text,
        );
        await page
          .getByRole('button', { name: 'Review export results', exact: true })
          .click();
        await page
          .getByRole('dialog', { name: 'Export results', exact: true })
          .waitFor();
        await page
          .getByText(join(destination, 'third_edited.mp4'), { exact: true })
          .waitFor();
        await page.getByRole('button', { name: 'Done', exact: true }).click();
      });
      const saved: unknown = JSON.parse(
        await readFile(join(profile, 'workspace.json'), 'utf8'),
      );
      assert.ok(
        saved &&
          typeof saved === 'object' &&
          'version' in saved &&
          saved.version === 2,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'packaged desktop resolves offline assets, fits its minimum window and relaunches',
  { timeout: 90000 },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), 'video-editor-desktop-test-'));
    try {
      for (let launch = 0; launch < 2; launch += 1) {
        await withPackagedApp(bundle, profile, async (page, context) => {
          await waitForStatus(page, 'Bundled resources verified');
          await context.setOffline(true);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForStatus(page, 'Bundled resources verified');
          assert.deepEqual(
            await page.evaluate(() => {
              if (!window.desktop) throw new Error('Desktop bridge missing.');
              return {
                require: typeof Reflect.get(window, 'require'),
                process: typeof Reflect.get(window, 'process'),
                bridge: Object.keys(window.desktop),
              };
            }),
            {
              require: 'undefined',
              process: 'undefined',
              bridge: [
                'exportQueue',
                'loadWorkspace',
                'saveWorkspace',
                'removeVideo',
                'clearWorkspace',
                'relinkVideo',
                'recoverWorkspace',
                'resetWorkspace',
                'onWorkspaceFlush',
                'getBootstrap',
                'importVideo',
                'exportVideo',
                'getExportProgress',
                'cancelExport',
                'revealExport',
                'startPreview',
                'stopPreview',
                'setHistoryMenuState',
                'onHistoryCommand',
              ],
            },
          );
          assert.equal(
            await page
              .getByRole('button', { name: 'Import videos', exact: true })
              .first()
              .isDisabled(),
            false,
          );
          await page.getByText('Resource details', { exact: true }).click();
          assert.equal(
            await page.getByText('FFmpeg', { exact: true }).count(),
            1,
          );
          assert.equal(
            await page.getByText('ffprobe', { exact: true }).count(),
            1,
          );
          const manifest = await readManifest(join(root, 'resources'));
          assert.equal(
            await page.locator('.resource-item.ready').count(),
            manifest.resources.length,
          );
          assert.equal(await page.evaluate(() => document.fonts.size), 5);
          await page.getByText('Resource details', { exact: true }).click();

          if (launch === 0) {
            await page.screenshot({
              path: join(root, 'out/packaged-empty-desktop.png'),
            });
            await page.evaluate(() => window.resizeTo(1100, 700));
            await page.waitForFunction(
              () => window.outerWidth === 1100 && window.outerHeight === 700,
            );
            await page.evaluate(async () => {
              window.resizeTo(900, 600);
              await new Promise<void>((done) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => done()),
                ),
              );
            });
            assert.deepEqual(
              await page.evaluate(() => [
                window.outerWidth,
                window.outerHeight,
              ]),
              [1100, 700],
            );
            const layout = await page.evaluate(() => ({
              overflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
              sidebar: document
                .querySelector('.video-sidebar')
                ?.getBoundingClientRect().width,
              inspector: document
                .querySelector('.text-inspector')
                ?.getBoundingClientRect().width,
            }));
            assert.deepEqual(layout, {
              overflow: false,
              sidebar: 240,
              inspector: 280,
            });
            await page.screenshot({
              path: join(root, 'out/packaged-minimum-desktop.png'),
            });
            await page.getByRole('button', { name: 'Check again' }).focus();
            await page.keyboard.press('Tab');
            assert.equal(
              await page.evaluate(() =>
                document.activeElement?.textContent?.trim(),
              ),
              'Resource details',
            );
            assert.equal(
              await page
                .locator('summary')
                .evaluate((element) => getComputedStyle(element).outlineStyle),
              'solid',
            );
            await page.getByRole('button', { name: 'Check again' }).click();
            await waitForStatus(page, 'Bundled resources verified');
          }
        });
      }
    } finally {
      await rm(profile, { recursive: true });
    }
  },
);

test(
  'missing and corrupt fonts show recoverable errors in the real application',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-damaged-bundle-'),
    );
    try {
      const copy = join(directory, 'Video Text Editor.app');
      await cp(bundle, copy, {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      });
      const relativeFont =
        'Contents/Resources/resources/fonts/noto-sans/Regular.ttf';
      const originalFont = join(bundle, relativeFont);
      const testFont = join(copy, relativeFont);
      await rm(testFont);
      await withPackagedApp(copy, join(directory, 'profile'), async (page) => {
        await waitForStatus(page, 'Bundled resources need attention');
        const errors = page.locator('.resource-item.error');
        assert.equal(await errors.count(), 1);
        assert.equal(await errors.isVisible(), true);
        assert.match(await errors.innerText(), /ENOENT/);

        await copyFile(originalFont, testFont);
        await page.getByRole('button', { name: 'Check again' }).click();
        await waitForStatus(page, 'Bundled resources verified');

        await writeFile(testFont, 'deliberately-corrupted-font-fixture');
        await page.getByRole('button', { name: 'Check again' }).click();
        await waitForStatus(page, 'Bundled resources need attention');
        assert.equal(await errors.isVisible(), true);
        assert.match(await errors.innerText(), /Checksum mismatch/);

        await copyFile(originalFont, testFont);
        await page.getByRole('button', { name: 'Check again' }).click();
        await waitForStatus(page, 'Bundled resources verified');
        assert.equal(await page.evaluate(() => document.fonts.size), 5);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);
