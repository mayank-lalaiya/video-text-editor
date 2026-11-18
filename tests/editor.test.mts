import assert from 'node:assert/strict';
import {
  startCurrentExport,
  finishCurrentExport,
  acknowledgeCancellation,
} from './export-helpers.mts';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  _electron,
  type Page,
  type ElectronApplication,
} from 'playwright-core';
import { z } from 'zod';
import { HANDLES } from '../src/shared/editor.ts';
import { SavedWorkspaceSchema } from '../src/main/workspace/store.ts';
import { emptyWorkspace } from '../src/shared/workspace.ts';
import { setNativeFiles, withPackagedApp } from './packaged-app.mts';
import { exportCodec, posterFilters } from '../src/main/media/colour.ts';
import { MediaWorker } from '../src/main/media/worker.ts';
import {
  describeVideo,
  probeVideo,
  validateOutput,
} from '../src/main/media/probe.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const ffmpeg = join(root, 'resources/media-tools/darwin-arm64/ffmpeg');
const ffprobe = join(root, 'resources/media-tools/darwin-arm64/ffprobe');
const electronPath = z
  .string()
  .min(1)
  .parse(createRequire(import.meta.url)('electron'));

async function fixture(path: string) {
  await execute(ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x180:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(eq(n\\,4800)\\,0.8\\,0):s=48000:d=2',
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    '1M',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-shortest',
    path,
  ]);
}
async function checkPlayback(page: Page) {
  await page.getByRole('button', { name: 'Mute preview', exact: true }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return (
      video &&
      !video.paused &&
      video.readyState >= 2 &&
      video.currentTime > 0.15
    );
  });
  const dimensions = await page.locator('video').evaluate((node) => {
    if (!(node instanceof HTMLVideoElement))
      throw new Error('Video element unavailable.');
    return [node.videoWidth, node.videoHeight];
  });
  assert.ok(Math.max(...dimensions) <= 720);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  return dimensions;
}
async function geometry(page: Page) {
  return page.locator('.video-source-layer textarea').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      x: parseFloat(style.left),
      y: parseFloat(style.top),
      width: parseFloat(style.width),
      height: parseFloat(style.height),
      fontSize: parseFloat(style.fontSize),
    };
  });
}
async function fillNumber(page: Page, name: string, value: number) {
  await page.getByRole('spinbutton', { name, exact: true }).fill(String(value));
  await page.getByRole('spinbutton', { name, exact: true }).press('Tab');
}
async function waitForOverlay(directory: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('.video-text-editor-'))
        continue;
      try {
        const bytes = await readFile(join(directory, entry.name, 'text.png'));
        if (
          bytes.length > 32 &&
          bytes.subarray(-8, -4).toString('ascii') === 'IEND'
        )
          return bytes;
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
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('No full-resolution text overlay was produced.');
}
async function pixels(page: Page, png: Buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Pixel comparison canvas is unavailable.');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let left = image.width,
      top = image.height,
      right = -1,
      bottom = -1,
      opaque = 0,
      transparent = 0,
      colourful = 0;
    const rows: number[] = [];
    for (let y = 0; y < image.height; y += 1) {
      let occupied = 0;
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        const r = data[offset] ?? 0,
          g = data[offset + 1] ?? 0,
          b = data[offset + 2] ?? 0,
          a = data[offset + 3] ?? 0;
        if (a === 0) transparent += 1;
        if (a > 128 && Math.max(r, g, b) > 60) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
          occupied += 1;
          opaque += 1;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 50) colourful += 1;
        }
      }
      if (occupied > 0) rows.push(y);
    }
    return {
      width: image.width,
      height: image.height,
      left,
      top,
      right,
      bottom,
      opaque,
      transparent,
      colourful,
      rows,
    };
  }, png.toString('base64'));
}

async function capturePoster(page: Page): Promise<Buffer> {
  const bounds = await page.locator('.video-poster').boundingBox();
  if (!bounds) throw new Error('The oriented poster is not visible.');
  const session = await page.context().newCDPSession(page);
  try {
    // Playwright's CSS-scale resizing strips ICC profiles from wide-gamut screenshots.
    const capture = await session.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...bounds, scale: 1 },
    });
    return Buffer.from(capture.data, 'base64');
  } finally {
    await session.detach();
  }
}

async function withEditor(
  directory: string,
  destination: string,
  run: (page: Page, application: ElectronApplication) => Promise<void>,
) {
  const application = await _electron.launch({
    executablePath: electronPath,
    // CDP can return untagged Display P3 PNGs; compare screenshot pixels in sRGB.
    args: [
      root,
      `--user-data-dir=${join(directory, 'profile')}`,
      '--force-color-profile=srgb',
    ],
    env: {
      ...process.env,
      VIDEO_EDITOR_TEST_BACKGROUND:
        process.env.VIDEO_EDITOR_TEST_BACKGROUND ?? '1',
    },
  });
  const child = application.process();
  let nativeErrors = '';
  let page: Page | undefined;
  const failures: unknown[] = [];
  child.stderr?.on('data', (data: Buffer) => {
    nativeErrors = (nativeErrors + data.toString()).slice(-16000);
  });
  try {
    page = await application.firstWindow();
    const verifyBackground = async () => {
      if (process.env.VIDEO_EDITOR_TEST_BACKGROUND === '0') return;
      const windows = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({
          id: window.id,
          visible: window.isVisible(),
          focused: window.isFocused(),
        })),
      );
      assert.ok(
        windows.every((window) => !window.visible && !window.focused),
        `Automated test windows must remain hidden and unfocused: ${JSON.stringify(windows)}`,
      );
    };
    await verifyBackground();
    const acceptReplacement = () => {
      window.confirm = () => true;
    };
    await page.addInitScript(acceptReplacement);
    await page.evaluate(acceptReplacement);
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
      dialog.showMessageBoxSync = () => 1;
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, destination);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'confirm')
        void dialog.accept().catch((error: unknown) => {
          errors.push(`Confirmation failed: ${String(error)}`);
        });
    });
    await page
      .getByText('Bundled resources verified', { exact: true })
      .waitFor();
    await run(page, application);
    await verifyBackground();
    assert.deepEqual(errors, []);
  } catch (error) {
    failures.push(error);
    console.error('Editor proof failed.', error, nativeErrors, {
      exitCode: child.exitCode,
      signal: child.signalCode,
    });
    if (page && !page.isClosed())
      console.error(await page.locator('body').innerText());
  }
  let forced = false;
  const limit = setTimeout(() => {
    forced = true;
    child.kill('SIGKILL');
  }, 5000);
  try {
    await application.close();
    assert.equal(
      forced,
      false,
      'The native app must close without forced termination.',
    );
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(limit);
  }
  if (failures.length)
    throw new AggregateError(failures, 'Native editor proof failed.');
}

async function menuHistory(
  application: ElectronApplication,
  command: 'undo' | 'redo',
) {
  await application.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled)
      throw new Error(
        `History menu is ${item ? 'disabled' : 'missing'}: ${id}`,
      );
    item.click(item);
  }, `editor-${command}`);
}

async function waitText(page: Page, text: string) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector<HTMLTextAreaElement>('.video-text')?.value ===
      expected,
    text,
  );
}

test(
  'single-video history groups typing and gestures, restores deletions and respects field editing',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-history-'));
    const source = join(directory, 'history.mp4');
    const destination = join(directory, 'exports');
    try {
      await mkdir(destination);
      await fixture(source);
      await withEditor(directory, destination, async (page, application) => {
        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        const redo = page.getByRole('button', { name: 'Redo', exact: true });
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        assert.equal(
          await page
            .getByRole('button', { name: 'Add text', exact: true })
            .isDisabled(),
          true,
        );
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('history.mp4', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        const created = await geometry(page);
        assert.equal(created.x, (320 - created.width) / 2);
        assert.equal(created.y, (180 - created.height) / 2);
        assert.equal(await input.inputValue(), '');
        assert.equal(
          await input.evaluate((node) => node === document.activeElement),
          true,
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'Export current', exact: true })
            .isDisabled(),
          false,
        );
        await input.pressSequentially('Alpha', { delay: 15 });
        await menuHistory(application, 'undo');
        await waitText(page, '');
        await input.press('Meta+z');
        await input.waitFor({ state: 'detached' });
        await redo.click();
        await waitText(page, '');
        await redo.click();
        await waitText(page, 'Alpha');
        assert.equal(await undo.isDisabled(), false);
        assert.equal(await redo.isDisabled(), true);
        await page.locator('.text-selection').dblclick();
        await input.press('End');
        await input.pressSequentially('!');
        await input.press('Meta+a');
        await input.pressSequentially('New');
        await input.press('Meta+z');
        await waitText(page, 'Alpha!');
        await input.press('Meta+z');
        await waitText(page, 'Alpha');
        await input.press('End');
        await input.press('Enter');
        await input.pressSequentially('Second', { delay: 15 });
        await input.press('Meta+z');
        await waitText(page, 'Alpha');
        await input.press('Meta+Shift+z');
        await waitText(page, 'Alpha\nSecond');
        await input.press('Escape');
        const beforeDrag = await geometry(page);
        const frame = await page.locator('.text-selection').boundingBox();
        assert.ok(frame);
        await page.mouse.move(frame.x + 40, frame.y + frame.height / 2);
        await page.mouse.down();
        await page.mouse.move(frame.x + 62, frame.y + frame.height / 2 + 9, {
          steps: 12,
        });
        await page.mouse.up();
        const moved = await geometry(page);
        assert.ok(
          Math.abs(
            moved.x - beforeDrag.x - (22 * beforeDrag.width) / frame.width,
          ) < 0.01,
        );
        assert.ok(
          Math.abs(
            moved.y - beforeDrag.y - (9 * beforeDrag.height) / frame.height,
          ) < 0.01,
        );
        await undo.click();
        assert.deepEqual(
          await geometry(page),
          beforeDrag,
          'A complete drag must undo in one step.',
        );
        await redo.click();
        assert.deepEqual(await geometry(page), moved);
        const canvas = page.getByRole('group', {
          name: 'Video canvas',
          exact: true,
        });
        await canvas.press('ArrowRight');
        await canvas.press('Shift+ArrowDown');
        const nudged = await geometry(page);
        assert.equal(nudged.x, moved.x + 1);
        assert.equal(nudged.y, moved.y + 10);
        await page.locator('.text-selection').dblclick();
        await input.press('End');
        await input.press('Backspace');
        await waitText(page, 'Alpha\nSecon');
        assert.equal(await page.locator('.text-selection').count(), 1);
        await page.locator('.video-stage').click({ position: { x: 4, y: 4 } });
        await page.locator('.text-selection.not-selected').waitFor();
        await canvas.press('Backspace');
        assert.equal(
          await input.count(),
          1,
          'A deselected box must not receive object deletion.',
        );
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 3, y: 3 } });
        await canvas.press('Enter');
        assert.equal(await input.isEditable(), true);
        await input.press('Meta+Enter');
        await canvas.press('Backspace');
        await input.waitFor({ state: 'detached' });
        await undo.click();
        await waitText(page, 'Alpha\nSecon');
        assert.deepEqual(await geometry(page), nudged);
        await page
          .getByRole('button', { name: 'Delete text', exact: true })
          .click();
        await input.waitFor({ state: 'detached' });
        await menuHistory(application, 'undo');
        await waitText(page, 'Alpha\nSecon');
        await page.locator('.video-stage').click({ position: { x: 4, y: 4 } });
        await page.locator('.text-selection.not-selected').waitFor();
        assert.equal(
          await page
            .getByRole('button', { name: 'Resize text nw', exact: true })
            .isVisible(),
          false,
        );
        const hovered = await page.locator('.text-selection').boundingBox();
        assert.ok(hovered);
        await page.mouse.move(hovered.x + hovered.width - 15, hovered.y + 3);
        const deletion = page.getByRole('button', {
          name: 'Delete text box',
          exact: true,
        });
        await deletion.waitFor({ state: 'visible' });
        await page.mouse.move(hovered.x + hovered.width - 15, hovered.y - 6, {
          steps: 6,
        });
        assert.equal(
          await deletion.isVisible(),
          true,
          'The hover-delete bridge must stay usable.',
        );
        await deletion.click();
        await input.waitFor({ state: 'detached' });
        await undo.click();
        await waitText(page, 'Alpha\nSecon');
        const existing = await geometry(page);
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 3, y: 3 } });
        assert.deepEqual(
          await geometry(page),
          existing,
          'Background selection must not move existing text.',
        );
        const x = page.getByRole('spinbutton', { name: 'X', exact: true });
        await x.fill('123');
        await x.press('Home');
        await x.press('Delete');
        assert.equal(await x.inputValue(), '23');
        assert.equal((await geometry(page)).x, 23);
        assert.equal(
          await input.inputValue(),
          'Alpha\nSecon',
          'Field deletion must not delete the video text.',
        );
        const hex = page.getByRole('textbox', {
          name: 'Text colour HEX',
          exact: true,
        });
        await hex.focus();
        await hex.press('Meta+a');
        await page.keyboard.insertText('#123');
        await menuHistory(application, 'undo');
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLInputElement>(
              '[aria-label="Text colour HEX"]',
            )?.value !== '#123',
        );
        assert.equal(
          await input.inputValue(),
          'Alpha\nSecon',
          'Native field undo must not undo the video.',
        );
        await page.getByRole('button', { name: 'Bold', exact: true }).click();
        await x.fill('');
        await x.press('Tab');
        await page
          .getByRole('alert')
          .filter({ hasText: 'X must be a finite number' })
          .waitFor();
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page
          .getByRole('alert')
          .filter({ hasText: 'Already imported' })
          .waitFor();
        assert.equal(await input.inputValue(), 'Alpha\nSecon');
        await page
          .getByRole('button', { name: 'Dismiss error', exact: true })
          .click();
        const second = join(directory, 'second.mp4');
        await copyFile(source, second);
        await page.getByLabel('Choose a video').setInputFiles(second);
        await page
          .getByRole('button', { name: 'Open second.mp4', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .waitFor();
        await input.waitFor({ state: 'detached' });
        assert.equal(
          await undo.isDisabled(),
          true,
          'A newly imported video has independent session-local history.',
        );
        assert.equal(await redo.isDisabled(), true);
        assert.equal(await page.locator('.field-error').count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'single-video inspector validates inputs, edits opaque colours and keeps geometry across window fitting',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-inspector-'));
    const source = join(directory, 'inspector.mp4');
    const destination = join(directory, 'exports');
    try {
      await mkdir(destination);
      await fixture(source);
      await withEditor(directory, destination, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('inspector.mp4', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await input.fill('Colour\nProof');
        await input.press('Escape');
        await fillNumber(page, 'Font size', 14.5);
        await fillNumber(page, 'Font size', 1000000000);
        await page
          .getByRole('alert')
          .filter({ hasText: 'cannot be rendered accurately' })
          .waitFor();
        assert.equal((await geometry(page)).fontSize, 14.5);
        await page
          .getByRole('button', { name: 'Dismiss error', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Increase font size', exact: true })
          .click();
        assert.equal((await geometry(page)).fontSize, 15.5);
        await page
          .getByRole('button', { name: 'Decrease font size', exact: true })
          .click();
        assert.equal((await geometry(page)).fontSize, 14.5);
        for (const invalid of ['14.55', '0', '']) {
          const font = page.getByRole('spinbutton', {
            name: 'Font size',
            exact: true,
          });
          await font.fill(invalid);
          await font.press('Tab');
          await page
            .getByRole('alert')
            .filter({ hasText: 'Font size must be at least' })
            .waitFor();
          assert.equal((await geometry(page)).fontSize, 14.5);
          assert.equal(await font.getAttribute('aria-invalid'), 'true');
          await page
            .getByRole('button', { name: 'Dismiss error', exact: true })
            .click();
        }
        await fillNumber(page, 'Font size', 14.5);
        const hex = page.getByRole('textbox', {
          name: 'Text colour HEX',
          exact: true,
        });
        for (const invalid of ['#ZZ0000', '#FFFFFF80']) {
          await hex.fill(invalid);
          await hex.press('Tab');
          await page
            .getByRole('alert')
            .filter({ hasText: 'six-digit colour' })
            .waitFor();
          assert.equal(await hex.inputValue(), '#FFFFFF');
          await page
            .getByRole('button', { name: 'Dismiss error', exact: true })
            .click();
        }
        await page
          .getByRole('button', { name: 'Text colour', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Use colour #FF0000', exact: true })
          .click();
        const area = await page.locator('.colour-sv').boundingBox();
        assert.ok(area);
        await page.mouse.move(area.x + area.width - 1, area.y + 1);
        await page.mouse.down();
        await page.mouse.move(
          area.x + area.width / 2,
          area.y + area.height / 2,
          { steps: 8 },
        );
        await page.mouse.up();
        assert.equal(await hex.inputValue(), '#804040');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(
          await hex.inputValue(),
          '#FF0000',
          'A continuous colour drag must undo in one step.',
        );
        await page
          .getByRole('button', { name: 'Text colour', exact: true })
          .click();
        const hue = page.getByRole('slider', { name: 'Hue', exact: true });
        await hue.focus();
        await hue.press('Home');
        for (let step = 0; step < 120; step += 1) await hue.press('ArrowRight');
        await hue.press('Tab');
        assert.equal(await hex.inputValue(), '#00FF00');
        const brightness = page.getByRole('slider', {
          name: 'Brightness',
          exact: true,
        });
        await brightness.press('Home');
        await brightness.press('Tab');
        assert.equal(await hex.inputValue(), '#000000');
        await hue.press('End');
        for (let step = 0; step < 119; step += 1) await hue.press('ArrowLeft');
        await hue.press('Tab');
        await brightness.press('End');
        await brightness.press('Tab');
        assert.equal(
          await hex.inputValue(),
          '#0000FF',
          'Changing hue at black must retain the chosen hue.',
        );
        const saturation = page.getByRole('slider', {
          name: 'Saturation',
          exact: true,
        });
        await saturation.press('Home');
        await saturation.press('Tab');
        assert.equal(await hex.inputValue(), '#FFFFFF');
        await saturation.press('End');
        await saturation.press('Escape');
        assert.equal(await hex.inputValue(), '#0000FF');
        assert.equal(
          await hue.count(),
          0,
          'Escape must close the anchored picker.',
        );
        await hex.fill('#fFc040');
        await hex.press('Tab');
        assert.equal(await hex.inputValue(), '#FFC040');
        await page
          .getByLabel('Font family', { exact: true })
          .selectOption('serif');
        await page.getByRole('button', { name: 'Bold', exact: true }).click();
        await page.getByRole('button', { name: 'Italic', exact: true }).click();
        await page
          .getByRole('button', { name: 'Align centre', exact: true })
          .click();
        await fillNumber(page, 'Width', 100);
        await fillNumber(page, 'Height', 100);
        await fillNumber(page, 'X', -1000);
        await fillNumber(page, 'Y', 1200);
        const offscreen = await geometry(page);
        await page
          .getByRole('button', { name: 'Centre in video', exact: true })
          .click();
        const centred = await geometry(page);
        assert.equal(centred.x, (320 - centred.width) / 2);
        assert.equal(centred.y, (180 - centred.height) / 2);
        assert.equal(centred.fontSize, offscreen.fontSize);
        assert.equal(centred.width, offscreen.width);
        assert.equal(centred.height, offscreen.height);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.deepEqual(await geometry(page), offscreen);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        assert.deepEqual(await geometry(page), centred);
        const oldWidth = await page
          .locator('.video-positioner')
          .evaluate((node) => node.getBoundingClientRect().width);
        await page.evaluate(() => window.resizeTo(1100, 700));
        await page.waitForFunction(
          () => window.outerWidth === 1100 && window.outerHeight === 700,
        );
        await page.waitForFunction(
          (old) =>
            document.querySelector('.video-positioner')?.getBoundingClientRect()
              .width !== old,
          oldWidth,
        );
        assert.deepEqual(
          await geometry(page),
          centred,
          'Application fitting must not rewrite source geometry.',
        );
        const layout = await page.evaluate(() => {
          const panel = document.querySelector('.inspector-scroll');
          if (!panel) throw new Error('Inspector unavailable.');
          return {
            overflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
            inspectorOverflow: panel.scrollWidth > panel.clientWidth,
            scrollable: panel.scrollHeight > panel.clientHeight,
          };
        });
        assert.deepEqual(layout, {
          overflow: false,
          inspectorOverflow: false,
          scrollable: true,
        });
        const font = page.getByRole('spinbutton', {
          name: 'Font size',
          exact: true,
        });
        await font.focus();
        await font.press('Tab');
        assert.equal(
          await page
            .getByRole('button', { name: 'Decrease font size', exact: true })
            .evaluate(
              (node) =>
                node === document.activeElement &&
                getComputedStyle(node).outlineStyle !== 'none',
            ),
          true,
        );
        const [overlay] = await Promise.all([
          waitForOverlay(destination),
          startCurrentExport(page),
        ]);
        await finishCurrentExport(page);
        const frame = join(directory, 'edited.png');
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-i',
          join(destination, 'inspector_edited.mp4'),
          '-frames:v',
          '1',
          frame,
        ]);
        const [overlayPixels, exportedPixels] = await Promise.all([
          pixels(page, overlay),
          pixels(page, await readFile(frame)),
        ]);
        for (const key of ['left', 'top', 'right', 'bottom'] as const)
          assert.ok(
            Math.abs(overlayPixels[key] - exportedPixels[key]) <= 1,
            `Restored style/geometry differs in the export: ${key}`,
          );
        assert.ok(exportedPixels.colourful > 100);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'single-video native text and SDR export share source geometry and bundled emoji',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-text-proof-'));
    const source = join(directory, 'original.mp4');
    const destination = join(directory, 'exports');
    await mkdir(destination);
    await fixture(source);
    const originalHash = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
    try {
      await withEditor(directory, destination, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('original.mp4', { exact: true }).waitFor();
        await page.locator('.video-poster').evaluate(async (image) => {
          if (!(image instanceof HTMLImageElement))
            throw new Error('Missing poster.');
          await image.decode();
        });
        await page.locator('.video-stage').evaluate((element) => {
          element.style.flex = 'none';
          element.style.width = '400px';
          element.style.height = '260px';
        });
        await page.waitForFunction(() => {
          const layer = document.querySelector('.video-source-layer');
          return (
            layer &&
            getComputedStyle(layer).transform === 'matrix(1, 0, 0, 1, 0, 0)'
          );
        });
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 24, y: 20 } });
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        const created = await geometry(page);
        assert.equal(created.x, 24);
        assert.equal(created.y, 20);
        for (const cluster of ['😀', '👍🏽', '🇨🇦', '👨‍👩‍👧‍👦', 'e\u0301']) {
          await input.fill(`A${cluster}B`);
          await input.press('End');
          await input.press('ArrowLeft');
          await input.press('ArrowLeft');
          assert.equal(
            await input.evaluate((element) => {
              if (!(element instanceof HTMLTextAreaElement))
                throw new Error('Missing native text input.');
              return element.selectionStart;
            }),
            1,
            `${cluster} must be a single caret step`,
          );
        }
        await input.fill(
          'Line one\nUnbrokenWordWithoutAnySeparators\n😀 👍🏽 🇨🇦 👨‍👩‍👧‍👦',
        );
        await input.press('Meta+Enter');
        await fillNumber(page, 'Font size', 14);
        await fillNumber(page, 'Width', 160);
        await fillNumber(page, 'Height', 150);
        const initial = await geometry(page);
        assert.equal(initial.fontSize, 14);
        const body = await page.locator('.text-selection').boundingBox();
        assert.ok(body);
        await page.mouse.move(body.x + 30, body.y + 20);
        await page.mouse.down();
        await page.mouse.move(body.x + 42, body.y + 28);
        await page.mouse.up();
        const moved = await geometry(page);
        assert.ok(Math.abs(moved.x - initial.x - 12) < 0.1);
        assert.ok(Math.abs(moved.y - initial.y - 8) < 0.1);
        for (const handle of HANDLES) {
          const before = await geometry(page);
          const button = page.getByRole('button', {
            name: `Resize text ${handle}`,
            exact: true,
          });
          const bounds = await button.boundingBox();
          assert.ok(bounds);
          await page.mouse.move(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          );

          await page.mouse.down();
          await page.mouse.move(
            bounds.x + bounds.width / 2 + 5,
            bounds.y + bounds.height / 2 + 4,
            { steps: 3 },
          );
          await page.mouse.up();
          const after = await geometry(page);
          assert.equal(
            after.fontSize,
            14,
            `${handle} must not change font size`,
          );
          if (handle.includes('e') || handle.includes('w'))
            assert.ok(
              Math.abs(after.width - before.width) >= 4,
              `${handle} must resize horizontally`,
            );
          if (handle.includes('n') || handle.includes('s'))
            assert.ok(
              Math.abs(after.height - before.height) >= 3,
              `${handle} must resize vertically: ${JSON.stringify({ before, after, bounds })}`,
            );
          if (handle.includes('w'))
            assert.ok(
              Math.abs(after.x + after.width - before.x - before.width) < 0.1,
            );
          if (handle.includes('n'))
            assert.ok(
              Math.abs(after.y + after.height - before.y - before.height) < 0.1,
            );
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          assert.deepEqual(
            await geometry(page),
            before,
            `${handle} resize must undo as one edit.`,
          );
          await page.getByRole('button', { name: 'Redo', exact: true }).click();
          assert.deepEqual(await geometry(page), after);
        }
        await fillNumber(page, 'X', 24);
        await fillNumber(page, 'Y', 20);
        await fillNumber(page, 'Width', 160);
        await fillNumber(page, 'Height', 140);
        const beforeSelect = await geometry(page);
        await fillNumber(page, 'Height', 1);
        await page
          .getByRole('alert')
          .filter({ hasText: 'Height must be at least' })
          .waitFor();
        assert.deepEqual(
          await geometry(page),
          beforeSelect,
          'Invalid numeric height must keep the previous valid geometry.',
        );
        await page
          .getByRole('button', { name: 'Dismiss error', exact: true })
          .click();
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 300, y: 170 } });
        assert.deepEqual(
          await geometry(page),
          beforeSelect,
          'Clicking another video location must not move existing text.',
        );
        await page.getByRole('button', { name: 'Bold', exact: true }).click();
        await page.getByRole('button', { name: 'Italic', exact: true }).click();
        await page.locator('.text-selection').evaluate((element) => {
          element.style.display = 'none';
        });
        const preview = await page
          .locator('.video-positioner')
          .screenshot({ scale: 'css' });
        const [overlay] = await Promise.all([
          waitForOverlay(destination),
          startCurrentExport(page),
        ]);
        await finishCurrentExport(page, 40000);
        const output = join(destination, 'original_edited.mp4');
        const firstOutputHash = createHash('sha256')
          .update(await readFile(output))
          .digest('hex');
        const frame = join(directory, 'decoded.png');
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-i',
          output,
          '-frames:v',
          '1',
          frame,
        ]);
        const [previewPixels, overlayPixels, outputPixels] = await Promise.all([
          pixels(page, preview),
          pixels(page, overlay),
          pixels(page, await readFile(frame)),
        ]);
        assert.equal(overlayPixels.width, 320);
        assert.equal(overlayPixels.height, 180);
        assert.ok(
          overlayPixels.transparent > 40000,
          'The source-resolution PNG must remain transparent outside text.',
        );
        assert.ok(
          overlayPixels.colourful > 10,
          'Bundled emoji must keep intrinsic colours with white text.',
        );
        for (const comparison of [previewPixels, outputPixels]) {
          for (const edge of ['left', 'top', 'right', 'bottom'] as const)
            assert.ok(
              Math.abs(comparison[edge] - overlayPixels[edge]) <= 1,
              `${edge} differs by more than one source pixel: ${JSON.stringify({ comparison, overlayPixels })}`,
            );
        }
        await startCurrentExport(page);
        await finishCurrentExport(page);
        await page
          .getByRole('button', { name: 'Export current', exact: true })
          .waitFor({ state: 'visible' });
        await page.waitForFunction(
          () =>
            Array.from(
              document.querySelectorAll<HTMLButtonElement>(
                '.app-toolbar button',
              ),
            ).find((button) => button.textContent?.trim() === 'Export current')
              ?.disabled === false,
        );
        await readFile(join(destination, 'original_edited_2.mp4'));
        assert.equal(
          createHash('sha256')
            .update(await readFile(output))
            .digest('hex'),
          firstOutputHash,
        );
        assert.equal(
          createHash('sha256')
            .update(await readFile(source))
            .digest('hex'),
          originalHash,
        );
        assert.deepEqual((await readdir(destination)).sort(), [
          'original_edited.mp4',
          'original_edited_2.mp4',
        ]);
        await mkdir(join(root, 'out'), { recursive: true });
        await copyFile(output, join(root, 'out/milestone-2-demo.mp4'));
        await writeFile(join(root, 'out/milestone-2-overlay.png'), overlay);
        await page.locator('.video-stage').evaluate((element) => {
          element.style.removeProperty('flex');
          element.style.removeProperty('width');
          element.style.removeProperty('height');
        });
        await page.locator('.inspector-scroll').evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.screenshot({
          path: join(root, 'out/milestone-2-desktop.png'),
        });
        await page.evaluate(() => window.resizeTo(1100, 700));
        await page.waitForFunction(
          () => window.outerWidth === 1100 && window.outerHeight === 700,
        );
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          false,
          'The populated editor must fit the minimum window width.',
        );
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'trimmed MP4 edit-list samples do not prevent an export that preserves displayed frames',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-edit-list-'));
    const destination = join(directory, 'exports');
    try {
      await mkdir(destination);
      const raw = join(directory, 'full.mp4');
      const source = join(directory, 'trimmed.mp4');
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=black:s=320x180:r=25:d=2',
        '-c:v',
        'h264_videotoolbox',
        '-b:v',
        '1M',
        '-g',
        '50',
        raw,
      ]);
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-ss',
        '0.2',
        '-i',
        raw,
        '-t',
        '1',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'disabled',
        '-use_editlist',
        '1',
        source,
      ]);
      const { stdout } = await execute(ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_frames',
        '-of',
        'json',
        source,
      ]);
      const metadata: unknown = JSON.parse(stdout);
      const counts = z
        .object({
          streams: z
            .array(z.object({ nb_frames: z.coerce.number() }))
            .length(1),
        })
        .parse(metadata);
      const originalTimes = await frameTimes(source);
      assert.equal(originalTimes.length, 25);
      assert.ok(
        (counts.streams[0]?.nb_frames ?? 0) > originalTimes.length,
        'The regression fixture must include hidden samples.',
      );
      await withEditor(directory, destination, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('trimmed.mp4', { exact: true }).waitFor();
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 30, y: 30 } });
        const text = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await text.fill('Edit-list proof');
        await text.press('Meta+Enter');
        await startCurrentExport(page);
        await finishCurrentExport(page, 30000);
        const times = await frameTimes(join(destination, 'trimmed_edited.mp4'));
        assert.equal(times.length, originalTimes.length);
        originalTimes.forEach((time, index) =>
          assert.ok(Math.abs(time - (times[index] ?? Infinity)) <= 0.001),
        );
        assert.deepEqual(await readdir(destination), ['trimmed_edited.mp4']);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

const FramesSchema = z.object({
  frames: z.array(
    z.object({ best_effort_timestamp_time: z.coerce.number().finite() }),
  ),
});

test(
  'typing near video edges cannot scroll text away from its exported position',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-edge-regression-'),
    );
    const source = join(directory, 'edge.mp4');
    const destination = join(directory, 'exports');
    await mkdir(destination);
    await fixture(source);
    try {
      await withEditor(directory, destination, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .waitFor();
        await page.locator('.video-stage').evaluate((node) => {
          node.style.flex = 'none';
          node.style.width = '400px';
          node.style.height = '260px';
        });
        await page.waitForFunction(() => {
          const layer = document.querySelector('.video-source-layer');
          return (
            layer &&
            getComputedStyle(layer).transform === 'matrix(1, 0, 0, 1, 0, 0)'
          );
        });
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 300, y: 160 } });
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await input.pressSequentially('PLACED NEAR THE RIGHT EDGE');
        await input.press('Enter');
        await input.pressSequentially('BOTTOM EDGE');
        await input.press('Meta+Enter');
        assert.deepEqual(
          await page
            .locator('.video-source-layer')
            .evaluate((node) => [node.scrollLeft, node.scrollTop]),
          [0, 0],
        );
        assert.deepEqual(
          await page
            .locator('.video-stage')
            .evaluate((node) => [node.scrollLeft, node.scrollTop]),
          [0, 0],
        );
        const box = await geometry(page);
        assert.equal(box.x, 300);
        assert.equal(box.y, 160);
        await page.locator('.text-selection').evaluate((node) => {
          node.style.display = 'none';
        });
        const displayed = await pixels(
          page,
          await page.locator('.video-positioner').screenshot({ scale: 'css' }),
        );
        const overlay = waitForOverlay(destination);
        await startCurrentExport(page);
        const exported = await pixels(page, await overlay);
        await finishCurrentExport(page);
        assert.ok(displayed.opaque > 0 && exported.opaque > 0);
        for (const key of ['left', 'top', 'right', 'bottom'] as const)
          assert.ok(
            Math.abs(displayed[key] - exported[key]) <= 1,
            `Edge placement mismatch: ${key}`,
          );
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'real-footage source-aware exports bound size and preserve non-text quality, timing and AAC',
  { timeout: 900000, skip: !process.env.VIDEO_EDITOR_REAL_VIDEO_INPUTS },
  async (context) => {
    const sources = z
      .array(z.string().min(1))
      .min(1)
      .parse(JSON.parse(process.env.VIDEO_EDITOR_REAL_VIDEO_INPUTS ?? 'null'));
    const destination = z
      .string()
      .min(1)
      .parse(process.env.VIDEO_EDITOR_REAL_EXPORTS);
    await mkdir(destination);
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-real-footage-'),
    );
    const worker = new MediaWorker();
    const controller = new AbortController();
    const hash = async (path: string) => {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(path)) digest.update(chunk);
      return digest.digest('hex');
    };
    const report: object[] = [];
    const fidelityFailures: string[] = [];
    const packaged = process.env.VIDEO_EDITOR_PACKAGED_APP;
    try {
      const check = async (page: Page) => {
        for (const source of sources) {
          const beforeHash = await hash(source);
          const original = await probeVideo(
            worker,
            ffprobe,
            source,
            controller.signal,
            { countFrames: true },
          );
          const asset = describeVideo(
            original,
            '00000000-0000-4000-8000-000000000001',
            basename(source),
          );
          if (packaged)
            await setNativeFiles(page, 'input[aria-label="Choose a video"]', [
              source,
            ]);
          else await page.getByLabel('Choose a video').setInputFiles(source);
          await page
            .getByRole('button', {
              name: `Open ${basename(source)}`,
              exact: true,
            })
            .click();
          await page
            .getByRole('button', { name: 'Add text', exact: true })
            .click();
          const text = page.getByRole('textbox', {
            name: 'Video text',
            exact: true,
          });
          await text.fill('Export quality check');
          await text.press('Meta+Enter');
          await fillNumber(page, 'Font size', 48);
          await fillNumber(page, 'X', 30);
          await fillNumber(page, 'Y', 30);
          await startCurrentExport(page, !packaged);
          await finishCurrentExport(page, 180000);
          const output = join(
            destination,
            basename(source).replace(/\.[^.]+$/, '_edited.mp4'),
          );
          const encoded = await probeVideo(
            worker,
            ffprobe,
            output,
            controller.signal,
            { countFrames: true },
          );
          validateOutput(original, encoded, asset);
          const codec = exportCodec(
            asset,
            original.streams.find((stream) => stream.codec_type === 'video')
              ?.codec_name,
          );
          assert.equal(
            encoded.streams.find((stream) => stream.codec_type === 'video')
              ?.codec_name,
            codec,
          );
          const cropHeight = Math.floor((asset.height * 0.75) / 2) * 2;
          const cropY = asset.height - cropHeight;
          const crop = `crop=${asset.width}:${cropHeight}:0:${cropY},settb=AVTB,setpts=PTS-STARTPTS`;
          const { stderr } = await execute(
            ffmpeg,
            [
              '-hide_banner',
              '-threads',
              '2',
              '-i',
              source,
              '-threads',
              '2',
              '-i',
              output,
              '-filter_complex_threads',
              '2',
              '-filter_complex',
              `[0:v]${crop},split=2[rp][rs];[1:v]${crop},split=2[ep][es];[rp][ep]psnr[p];[rs][es]ssim[s]`,
              '-map',
              '[p]',
              '-map',
              '[s]',
              '-an',
              '-f',
              'null',
              '-',
            ],
            { maxBuffer: 2 * 1024 * 1024 },
          );
          const psnr = Number(/PSNR[^\n]*average:([\d.]+)/.exec(stderr)?.[1]);
          const ssim = Number(/SSIM[^\n]*All:([\d.]+)/.exec(stderr)?.[1]);
          if (!(psnr >= 42))
            fidelityFailures.push(
              `${basename(source)}: non-text PSNR ${psnr} dB is below 42 dB.`,
            );
          if (!(ssim >= 0.98))
            fidelityFailures.push(
              `${basename(source)}: balanced non-text SSIM ${ssim} is below 0.98.`,
            );
          const packets = async (path: string) => {
            const { stdout } = await execute(ffprobe, [
              '-v',
              'error',
              '-select_streams',
              'a',
              '-show_packets',
              '-show_entries',
              'packet=data_hash',
              '-show_data_hash',
              'sha256',
              '-of',
              'json',
              path,
            ]);
            return z
              .object({ packets: z.array(z.object({ data_hash: z.string() })) })
              .parse(JSON.parse(stdout))
              .packets.map((packet) => packet.data_hash);
          };
          assert.deepEqual(
            await packets(output),
            await packets(source),
            'AAC packet bytes must be unchanged.',
          );
          const beforeTimes = await frameTimes(source);
          const afterTimes = await frameTimes(output);
          assert.equal(afterTimes.length, beforeTimes.length);
          let timestampError = 0;
          beforeTimes.forEach((time, index) => {
            timestampError = Math.max(
              timestampError,
              Math.abs(time - (afterTimes[index] ?? Infinity)),
            );
          });
          assert.ok(
            timestampError <= 0.0000021,
            `Frame timing changed by ${timestampError}s.`,
          );
          assert.equal(
            await hash(source),
            beforeHash,
            'Original source bytes must not change.',
          );
          const sourceBytes = (await stat(source)).size;
          const outputBytes = (await stat(output)).size;
          assert.ok(
            outputBytes <= sourceBytes * 1.9 + 1000000,
            'Real-footage output must not exhibit excessive size growth.',
          );
          const result = {
            source,
            output,
            sourceBytes,
            outputBytes,
            sizeRatio: outputBytes / sourceBytes,
            codec,
            width: asset.width,
            height: asset.height,
            frames: afterTimes.length,
            duration: encoded.format.duration,
            nonTextPsnrDb: psnr,
            nonTextSsim: ssim,
            maximumFrameTimestampErrorSeconds: timestampError,
            aacPacketsUnchanged: true,
            sourceSha256Unchanged: beforeHash,
          };
          report.push(result);
          context.diagnostic(JSON.stringify(result));
          await writeFile(
            join(destination, 'verification.json'),
            JSON.stringify(report, null, 2),
          );
        }
      };
      if (packaged) {
        const profile = join(directory, 'profile');
        await mkdir(profile);
        await writeFile(
          join(profile, 'workspace.json'),
          JSON.stringify({
            version: 2,
            workspace: emptyWorkspace(),
            sources: {},
            outputFolder: destination,
          }),
        );
        await withPackagedApp(packaged, profile, async (page) => {
          await page
            .getByText('Bundled resources verified', { exact: true })
            .waitFor();
          await check(page);
        });
      } else await withEditor(directory, destination, check);
      assert.deepEqual(
        fidelityFailures,
        [],
        'Real-footage quality gates must pass for every source.',
      );
    } finally {
      controller.abort();
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'high-quality SDR exports preserve 10-bit precision, irregular timestamps and AAC packets',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-fidelity-regression-'),
    );
    const destination = join(directory, 'exports');
    await mkdir(destination);
    const detail = join(directory, 'detail.mp4');
    const irregular = join(directory, 'irregular.mp4');
    const tenBit = join(directory, 'ten-bit.mp4');
    const hevcEightBit = join(directory, 'hevc-eight-bit.mp4');
    const metadata = (codec: string) =>
      `${codec}_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0`;
    try {
      await execute(ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=640x360:r=30:d=1,noise=alls=12:allf=t+u:all_seed=42',
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=colour=pink:sample_rate=48000:duration=1:seed=42',
        '-c:v',
        'h264_videotoolbox',
        '-b:v',
        '20M',
        '-bsf:v',
        metadata('h264'),
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-b:a',
        '384k',
        '-shortest',
        detail,
      ]);
      await execute(ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=320x180:r=30:d=1',
        '-vf',
        "settb=1/1000,setpts='33*N+4*mod(N,3)'",
        '-fps_mode',
        'passthrough',
        '-enc_time_base',
        '1:1000',
        '-c:v',
        'h264_videotoolbox',
        '-q:v',
        '100',
        '-bsf:v',
        metadata('h264'),
        irregular,
      ]);
      await execute(ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        "nullsrc=s=320x180:r=30:d=1,format=yuv420p10le,geq=lum='64+876*X/(W-1)':cb=512:cr=512",
        '-c:v',
        'hevc_videotoolbox',
        '-profile:v',
        'main10',
        '-pix_fmt',
        'p010le',
        '-q:v',
        '100',
        '-bsf:v',
        metadata('hevc'),
        '-tag:v',
        'hvc1',
        tenBit,
      ]);
      await execute(ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=320x180:r=30:d=1',
        '-c:v',
        'hevc_videotoolbox',
        '-profile:v',
        'main',
        '-b:v',
        '2M',
        '-bsf:v',
        metadata('hevc'),
        '-tag:v',
        'hvc1',
        hevcEightBit,
      ]);
      await withEditor(directory, destination, async (page) => {
        for (const source of [detail, irregular, tenBit, hevcEightBit]) {
          await page.getByLabel('Choose a video').setInputFiles(source);
          await page.getByText(basename(source), { exact: true }).waitFor();
          await page
            .getByRole('button', {
              name: `Open ${basename(source)}`,
              exact: true,
            })
            .click();
          await page
            .getByRole('button', { name: 'Add text', exact: true })
            .click();
          const input = page.getByRole('textbox', {
            name: 'Video text',
            exact: true,
          });
          await input.fill('Fidelity regression');
          await input.press('Meta+Enter');
          await fillNumber(page, 'X', 2000);
          await startCurrentExport(page);
          await finishCurrentExport(page, 30000);
        }
      });
      const raw = async (path: string) =>
        (
          await execute(
            ffmpeg,
            [
              '-v',
              'error',
              '-i',
              path,
              '-map',
              '0:v:0',
              '-pix_fmt',
              'rgb24',
              '-f',
              'rawvideo',
              '-',
            ],
            { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
          )
        ).stdout;
      const before = await raw(detail);
      const after = await raw(join(destination, 'detail_edited.mp4'));
      assert.equal(before.length, after.length);
      let squared = 0;
      for (let index = 0; index < before.length; index++)
        squared += ((before[index] ?? 0) - (after[index] ?? 0)) ** 2;
      const psnr = squared
        ? 10 * Math.log10(255 ** 2 / (squared / before.length))
        : Infinity;
      assert.ok(
        psnr >= 42,
        `High-detail recompression PSNR ${psnr} dB is below 42 dB.`,
      );
      const audio = async (path: string) =>
        (
          await execute(
            ffmpeg,
            [
              '-v',
              'error',
              '-i',
              path,
              '-map',
              '0:a:0',
              '-c:a',
              'copy',
              '-f',
              'adts',
              '-',
            ],
            { encoding: 'buffer' },
          )
        ).stdout;
      assert.deepEqual(
        await audio(detail),
        await audio(join(destination, 'detail_edited.mp4')),
      );
      const originalTimes = await frameTimes(irregular);
      const outputTimes = await frameTimes(
        join(destination, 'irregular_edited.mp4'),
      );
      assert.equal(outputTimes.length, originalTimes.length);
      originalTimes.forEach((time, index) =>
        assert.ok(
          Math.abs(time - (outputTimes[index] ?? Infinity)) <= 0.000002,
        ),
      );
      const info = await execute(ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_streams',
        '-of',
        'json',
        join(destination, 'ten-bit_edited.mp4'),
      ]);
      const stream = z
        .object({
          streams: z.array(
            z.object({
              codec_name: z.string(),
              profile: z.string(),
              pix_fmt: z.string(),
              color_transfer: z.string(),
            }),
          ),
        })
        .parse(JSON.parse(info.stdout)).streams[0];
      assert.deepEqual(stream, {
        codec_name: 'hevc',
        profile: 'Main 10',
        pix_fmt: 'yuv420p10le',
        color_transfer: 'bt709',
      });
      const { stdout: hevcInfo } = await execute(ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,codec_tag_string,profile,pix_fmt',
        '-of',
        'json',
        join(destination, 'hevc-eight-bit_edited.mp4'),
      ]);
      assert.deepEqual(JSON.parse(hevcInfo).streams, [
        {
          codec_name: 'hevc',
          codec_tag_string: 'hvc1',
          profile: 'Main',
          pix_fmt: 'yuv420p',
        },
      ]);
      console.log(
        `High-detail SDR PSNR: ${psnr.toFixed(3)} dB; AAC packets unchanged; irregular timestamps within 2 us.`,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

async function frameTimes(file: string): Promise<number[]> {
  const { stdout } = await execute(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'frame=best_effort_timestamp_time',
    '-of',
    'json',
    file,
  ]);
  const value: unknown = JSON.parse(stdout);
  return FramesSchema.parse(value).frames.map(
    (frame) => frame.best_effort_timestamp_time,
  );
}
async function audioPeak(file: string, stream: number): Promise<number> {
  const { stdout } = await execute(
    ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      '-copyts',
      '-i',
      file,
      '-map',
      `0:a:${stream}`,
      '-af',
      'aresample=async=1:first_pts=0',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-f',
      's16le',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
  );
  let peak = 0,
    index = 0;
  for (let offset = 0; offset < stdout.length; offset += 2) {
    const sample = Math.abs(stdout.readInt16LE(offset));
    if (sample > peak) {
      peak = sample;
      index = offset / 2;
    }
  }
  assert.ok(peak > 1000, 'The soundtrack impulse must survive export.');
  return index / 48000;
}

async function compareImages(
  page: Page,
  overlay: Buffer,
  frame: Buffer,
  source: Buffer,
  poster: Buffer,
) {
  return page.evaluate(
    async (images) => {
      const decode = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No comparison context.');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const [text, output, original, preview] = await Promise.all(
        images.map(decode),
      );
      if (!text || !output || !original || !preview)
        throw new Error('Missing comparison image.');
      let samples = 0,
        difference = 0;
      const textMean = [0, 0, 0],
        outputMean = [0, 0, 0];
      for (let y = 2; y < text.height - 2; y += 1)
        for (let x = 2; x < text.width - 2; x += 1) {
          let interior = true;
          for (let dy = -2; dy <= 2; dy += 1)
            for (let dx = -2; dx <= 2; dx += 1) {
              if (
                (text.data[((y + dy) * text.width + x + dx) * 4 + 3] ?? 0) < 254
              )
                interior = false;
            }
          if (!interior) continue;
          samples += 1;
          for (let channel = 0; channel < 3; channel += 1) {
            textMean[channel] =
              (textMean[channel] ?? 0) +
              (text.data[(y * text.width + x) * 4 + channel] ?? 0);
            outputMean[channel] =
              (outputMean[channel] ?? 0) +
              (output.data[(y * output.width + x) * 4 + channel] ?? 0);
            difference += Math.abs(
              (text.data[(y * text.width + x) * 4 + channel] ?? 0) -
                (output.data[(y * output.width + x) * 4 + channel] ?? 0),
            );
          }
        }
      const corners = (image: ImageData) =>
        [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.1, 0.9],
          [0.9, 0.9],
        ].map(([x, y]) => {
          const offset =
            (Math.floor(image.height * (y ?? 0)) * image.width +
              Math.floor(image.width * (x ?? 0))) *
            4;
          return Array.from(image.data.slice(offset, offset + 3));
        });
      return {
        samples,
        colourError: difference / (samples * 3),
        textMean: textMean.map((value) => value / samples),
        outputMean: outputMean.map((value) => value / samples),
        originalCorners: corners(original),
        outputCorners: corners(output),
        posterCorners: corners(preview),
      };
    },
    [overlay, frame, source, poster].map((image) => image.toString('base64')),
  );
}

test(
  'rotated VFR input preserves frame times, both audio streams and off-frame clipping',
  { timeout: 120000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-vfr-proof-'));
    const destination = join(directory, 'exports');
    try {
      await mkdir(destination);
      const raw = join(directory, 'unrotated.mp4');
      const source = join(directory, 'rotated.mov');
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x180:r=12:d=2',
        '-f',
        'lavfi',
        '-i',
        'aevalsrc=if(eq(n\\,4800)\\,0.8\\,0):s=48000:d=3',
        '-filter:v',
        'drawbox=x=0:y=0:w=160:h=90:color=red:t=fill,drawbox=x=160:y=90:w=160:h=90:color=blue:t=fill,setpts=if(lt(N\\,12)\\,N/(12*TB)\\,(1+(N-12)/6)/TB)',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-map',
        '1:a:0',
        '-c:v',
        'h264_videotoolbox',
        '-b:v',
        '1M',
        '-fps_mode',
        'vfr',
        '-c:a',
        'aac',
        '-ac:a:0',
        '2',
        '-ac:a:1',
        '1',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        raw,
      ]);
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-display_rotation:v:0',
        '90',
        '-i',
        raw,
        '-map',
        '0',
        '-c',
        'copy',
        source,
      ]);
      const originalTimes = await frameTimes(source);
      const deltas = originalTimes
        .slice(1)
        .map((time, index) => time - (originalTimes[index] ?? 0));
      assert.ok(
        Math.max(...deltas) - Math.min(...deltas) > 0.05,
        'The fixture must really be VFR.',
      );
      await withEditor(directory, destination, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('rotated.mov', { exact: true }).waitFor();
        await page.getByText('180 x 320 / 3.00s', { exact: true }).waitFor();
        assert.deepEqual(await checkPlayback(page), [180, 320]);
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 30, y: 30 } });
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .fill('M');
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .press('Meta+Enter');
        await page
          .getByLabel('Font family', { exact: true })
          .selectOption('serif');
        await page.getByRole('button', { name: 'Bold', exact: true }).click();
        await fillNumber(page, 'Font size', 64);
        await fillNumber(page, 'Width', 140);
        await fillNumber(page, 'Height', 90);
        await fillNumber(page, 'X', 20);
        await fillNumber(page, 'Y', 115);
        await page
          .getByRole('button', { name: 'Align centre', exact: true })
          .click();
        await page
          .getByRole('textbox', { name: 'Text colour HEX', exact: true })
          .fill('#58B9E6');
        await page
          .getByRole('textbox', { name: 'Text colour HEX', exact: true })
          .press('Tab');
        const [overlay] = await Promise.all([
          waitForOverlay(destination),
          startCurrentExport(page),
        ]);
        await finishCurrentExport(page, 30000);
        const output = join(destination, 'rotated_edited.mp4');
        const encodedTimes = await frameTimes(output);
        assert.equal(encodedTimes.length, originalTimes.length);
        originalTimes.forEach((time, index) =>
          assert.ok(
            Math.abs(time - (encodedTimes[index] ?? Infinity)) <= 0.001,
            `VFR timestamp ${index} changed: ${time} -> ${encodedTimes[index]}`,
          ),
        );
        for (let stream = 0; stream < 2; stream += 1)
          assert.ok(
            Math.abs(
              (await audioPeak(source, stream)) -
                (await audioPeak(output, stream)),
            ) <= 0.02,
            'Decoded audio content moved by more than 20ms.',
          );
        const frame = join(directory, 'output-frame.png');
        const originalFrame = join(directory, 'source-frame.png');
        await Promise.all([
          execute(ffmpeg, [
            '-nostdin',
            '-v',
            'error',
            '-i',
            output,
            '-vf',
            'scale=in_color_matrix=bt709:out_range=full',
            '-frames:v',
            '1',
            frame,
          ]),
          execute(ffmpeg, [
            '-nostdin',
            '-v',
            'error',
            '-i',
            source,
            '-vf',
            'scale=in_color_matrix=bt709:out_range=full',
            '-frames:v',
            '1',
            originalFrame,
          ]),
        ]);
        const comparison = await compareImages(
          page,
          overlay,
          await readFile(frame),
          await readFile(originalFrame),
          await capturePoster(page),
        );
        assert.ok(
          comparison.samples > 5,
          'The colour comparison requires fully covered glyph-interior pixels.',
        );
        assert.ok(
          comparison.colourError < 5,
          `Text colour changed: ${JSON.stringify(comparison)}`,
        );
        [88, 185, 230].forEach((value, channel) =>
          assert.ok(
            Math.abs((comparison.textMean[channel] ?? -255) - value) < 3,
            'Captured text must match the selected HEX colour.',
          ),
        );
        context.diagnostic(`SDR colour proof: ${JSON.stringify(comparison)}`);
        for (const corners of [
          comparison.outputCorners,
          comparison.posterCorners,
        ]) {
          for (let index = 0; index < 4; index += 1)
            for (let channel = 0; channel < 3; channel += 1) {
              assert.ok(
                Math.abs(
                  (corners[index]?.[channel] ?? -255) -
                    (comparison.originalCorners[index]?.[channel] ?? 255),
                ) < 12,
                'Oriented picture corners must agree with the source.',
              );
            }
        }
        assert.equal((await pixels(page, overlay)).height, 320);
        await fillNumber(page, 'X', -70);
        await fillNumber(page, 'Y', -40);
        const [clipped] = await Promise.all([
          waitForOverlay(destination),
          startCurrentExport(page),
        ]);
        await finishCurrentExport(page);
        const clipping = await pixels(page, clipped);
        assert.equal(clipping.left, 0);
        assert.equal(clipping.top, 0);
        await page
          .getByRole('button', { name: 'Centre in video', exact: true })
          .click();
        const centred = await geometry(page);
        assert.equal(centred.x, 20);
        assert.equal(centred.y, 115);
        assert.equal(centred.fontSize, 64);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'HLG and PQ export real edited Main10 video without losing gradient precision, timing or audio',
  { timeout: 180000 },
  async (context) => {
    for (const transfer of ['hlg', 'pq'] as const) {
      const fullRange = transfer === 'pq';
      const directory = await mkdtemp(
        join(tmpdir(), `video-editor-${transfer}-`),
      );
      const source = join(directory, `${transfer}.mp4`);
      const destination = join(directory, 'exports');
      try {
        await mkdir(destination);
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `nullsrc=s=1024x128:r=25:d=2,format=yuv420p10le,geq=lum=${fullRange ? '1023' : '64+876'}*X/(W-1):cb=512:cr=512`,
          '-f',
          'lavfi',
          '-i',
          'aevalsrc=if(eq(n\\,4800)\\,0.8\\,0):s=48000:d=3',
          '-vf',
          `setpts=if(lt(N\\,25)\\,N/(25*TB)\\,(1+(N-25)/12.5)/TB),setparams=range=${fullRange ? 'full' : 'limited'}:color_primaries=bt2020:color_trc=${transfer === 'hlg' ? 'arib-std-b67' : 'smpte2084'}:colorspace=bt2020nc`,
          '-c:v',
          'hevc_videotoolbox',
          '-profile:v',
          'main10',
          '-pix_fmt',
          'p010le',
          '-q:v',
          '100',
          '-tag:v',
          'hvc1',
          '-color_primaries',
          'bt2020',
          '-color_trc',
          transfer === 'hlg' ? 'arib-std-b67' : 'smpte2084',
          '-colorspace',
          'bt2020nc',
          '-color_range',
          fullRange ? 'pc' : 'tv',
          '-fps_mode',
          'vfr',
          '-c:a',
          'aac',
          '-ac',
          '1',
          source,
        ]);
        const original = createHash('sha256')
          .update(await readFile(source))
          .digest('hex');
        await withEditor(directory, destination, async (page) => {
          await page.getByLabel('Choose a video').setInputFiles(source);
          await page.getByText(`${transfer}.mp4`, { exact: true }).waitFor();
          await page
            .getByText('SDR preview; HDR export', { exact: true })
            .waitFor();
          assert.deepEqual(await checkPlayback(page), [360, 46]);
          await page
            .locator('.video-source-layer')
            .click({ position: { x: 30, y: 20 } });
          const text = page.getByRole('textbox', {
            name: 'Video text',
            exact: true,
          });
          await text.fill('HDR white');
          await text.press('Meta+Enter');
          await fillNumber(page, 'Font size', 64);
          await page.getByRole('button', { name: 'Bold', exact: true }).click();
          await fillNumber(page, 'X', 16);
          await fillNumber(page, 'Y', 8);
          const [overlay] = await Promise.all([
            waitForOverlay(destination),
            startCurrentExport(page),
          ]);
          await finishCurrentExport(page, 60000);
          const output = join(destination, `${transfer}_edited.mp4`);
          const before = await frameTimes(source);
          const after = await frameTimes(output);
          const { stdout: frameMetadata } = await execute(ffprobe, [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'frame_side_data=side_data_type',
            '-of',
            'json=compact=1',
            output,
          ]);
          assert.doesNotMatch(
            frameMetadata,
            /dolby|dovi|hdr dynamic|dynamic hdr/i,
          );
          assert.equal(before.length, 50);
          assert.equal(after.length, before.length);
          before.forEach((time, index) =>
            assert.ok(Math.abs(time - (after[index] ?? Infinity)) <= 0.001),
          );
          assert.ok(
            Math.abs(
              (await audioPeak(source, 0)) - (await audioPeak(output, 0)),
            ) <= 0.02,
          );
          const frame = async (path: string, format: string) => {
            const { stdout } = await execute(
              ffmpeg,
              [
                '-nostdin',
                '-v',
                'error',
                '-i',
                path,
                '-frames:v',
                '1',
                '-pix_fmt',
                format,
                '-f',
                'rawvideo',
                'pipe:1',
              ],
              { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
            );
            return stdout;
          };
          const overlayPath = join(directory, 'overlay.png');
          await writeFile(overlayPath, overlay);
          const [reference, encoded, rgba] = await Promise.all([
            frame(source, 'yuv420p10le'),
            frame(output, 'yuv420p10le'),
            frame(overlayPath, 'rgba'),
          ]);
          const levels = new Set<number>();
          let difference = 0;
          for (let x = 0; x < 1024; x += 1) {
            const offset = (112 * 1024 + x) * 2;
            const actual = encoded.readUInt16LE(offset);
            levels.add(actual);
            difference += Math.abs(actual - reference.readUInt16LE(offset));
          }
          assert.ok(
            levels.size > 700,
            `${transfer}: ${levels.size} decoded gradient levels`,
          );
          assert.ok(
            difference / 1024 < 2,
            `${transfer}: non-text error ${difference / 1024}`,
          );
          let samples = 0,
            whiteError = 0;
          const whiteCode = fullRange ? 1023 * 0.580689 : 64 + 876 * 0.74988;
          for (let y = 2; y < 126; y += 1)
            for (let x = 2; x < 1022; x += 1) {
              let interior = true;
              for (let dy = -2; dy <= 2; dy += 1)
                for (let dx = -2; dx <= 2; dx += 1)
                  if (rgba.readUInt8(((y + dy) * 1024 + x + dx) * 4 + 3) < 254)
                    interior = false;
              if (!interior) continue;
              samples += 1;
              whiteError += Math.abs(
                encoded.readUInt16LE((y * 1024 + x) * 2) - whiteCode,
              );
            }
          assert.ok(
            samples > 50,
            `Only ${samples} uniform glyph-interior samples`,
          );
          assert.ok(
            whiteError / samples < 3,
            `${transfer}: white error ${whiteError / samples}`,
          );
          assert.equal(
            createHash('sha256')
              .update(await readFile(source))
              .digest('hex'),
            original,
          );
          assert.deepEqual(await readdir(destination), [
            `${transfer}_edited.mp4`,
          ]);
          context.diagnostic(
            JSON.stringify({
              transfer,
              frames: after.length,
              gradientLevels: levels.size,
              nonTextError: difference / 1024,
              whiteSamples: samples,
              whiteError: whiteError / samples,
            }),
          );
          if (transfer === 'hlg') {
            const rotated = join(directory, 'rotated-hlg.mov');
            await execute(ffmpeg, [
              '-nostdin',
              '-v',
              'error',
              '-display_rotation:v:0',
              '90',
              '-i',
              source,
              '-map',
              '0',
              '-c',
              'copy',
              rotated,
            ]);
            await page.getByLabel('Choose a video').setInputFiles(rotated);
            await page
              .getByRole('button', {
                name: 'Open rotated-hlg.mov',
                exact: true,
              })
              .click();
            assert.deepEqual(await checkPlayback(page), [46, 360]);
          }
        });
      } finally {
        await rm(directory, { recursive: true });
      }
    }
  },
);

test(
  'mirrored HLG and PQ playback and exports preserve the poster orientation',
  { timeout: 60000 },
  async (context) => {
    for (const fullRange of [false, true]) {
      const directory = await mkdtemp(
        join(tmpdir(), 'video-editor-mirrored-hdr-'),
      );
      try {
        const source = join(directory, 'gradient.mov');
        const mirrored = join(directory, 'mirrored.mov');
        const transfer = fullRange ? 'smpte2084' : 'arib-std-b67';
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `nullsrc=s=512x288:r=15:d=1,format=yuv420p10le,geq=lum=${fullRange ? '1023' : '64+876'}*Y/(H-1):cb=512:cr=512`,
          '-vf',
          `setparams=range=${fullRange ? 'full' : 'limited'}:color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc`,
          '-c:v',
          'hevc_videotoolbox',
          '-profile:v',
          'main10',
          '-pix_fmt',
          'p010le',
          '-tag:v',
          'hvc1',
          '-color_primaries',
          'bt2020',
          '-color_trc',
          transfer,
          '-colorspace',
          'bt2020nc',
          '-color_range',
          fullRange ? 'pc' : 'tv',
          source,
        ]);
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-display_vflip:v:0',
          '-i',
          source,
          '-c',
          'copy',
          mirrored,
        ]);
        await withEditor(directory, directory, async (page) => {
          await page.getByLabel('Choose a video').setInputFiles(mirrored);
          await page.getByText('mirrored.mov', { exact: true }).waitFor();
          await page.locator('.video-poster').evaluate(async (node) => {
            if (!(node instanceof HTMLImageElement))
              throw new Error('Poster unavailable.');
            await node.decode();
          });
          const poster = await capturePoster(page);
          assert.deepEqual(await checkPlayback(page), [360, 202]);
          const playback = await capturePoster(page);
          await page
            .getByRole('button', { name: 'Add text', exact: true })
            .click();
          const text = page.getByRole('textbox', {
            name: 'Video text',
            exact: true,
          });
          await text.fill('Orientation');
          await text.press('Meta+Enter');
          await fillNumber(page, 'Font size', 16);
          await fillNumber(page, 'X', 16);
          await fillNumber(page, 'Y', 100);
          await startCurrentExport(page);
          await finishCurrentExport(page);
          const { stdout: output } = await execute(
            ffmpeg,
            [
              '-nostdin',
              '-v',
              'error',
              '-i',
              join(directory, 'mirrored_edited.mp4'),
              '-frames:v',
              '1',
              '-vf',
              posterFilters(
                {
                  colour: {
                    dynamicRange: fullRange ? 'pq' : 'hlg',
                    range: fullRange ? 'full' : 'limited',
                    dolbyVision: false,
                  },
                },
                512,
                288,
              ),
              '-c:v',
              'png',
              '-f',
              'image2pipe',
              'pipe:1',
            ],
            { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
          );
          const samples = await page.evaluate(
            async ({ poster, playback, output }) => {
              const sample = async (base64: string) => {
                const image = new Image();
                image.src = `data:image/png;base64,${base64}`;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const drawing = canvas.getContext('2d');
                if (!drawing) throw new Error('Pixel sampling unavailable.');
                drawing.drawImage(image, 0, 0);
                const brightness = (fraction: number) =>
                  drawing
                    .getImageData(
                      Math.floor(image.width / 2),
                      Math.floor(image.height * fraction),
                      1,
                      1,
                    )
                    .data.slice(0, 3)
                    .reduce((sum, value) => sum + value, 0) / 3;
                return { top: brightness(0.15), bottom: brightness(0.85) };
              };
              return {
                poster: await sample(poster),
                playback: await sample(playback),
                output: await sample(output),
              };
            },
            {
              poster: poster.toString('base64'),
              playback: playback.toString('base64'),
              output: output.toString('base64'),
            },
          );
          context.diagnostic(JSON.stringify({ transfer, ...samples }));
          assert.ok(
            samples.poster.top > samples.poster.bottom + 100,
            'The fixture must visibly distinguish top from bottom.',
          );
          for (const image of [samples.playback, samples.output])
            assert.ok(
              Math.abs(samples.poster.top - image.top) < 10 &&
                Math.abs(samples.poster.bottom - image.bottom) < 10,
              'Playing/exporting mirrored HDR must not reverse the poster picture.',
            );
        });
      } finally {
        await rm(directory, { recursive: true });
      }
    }
  },
);

test(
  'bounded MediaSource preview plays across windows, seeks, mutes and pauses for text editing',
  { timeout: 60000 },
  async (context) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-preview-proof-'),
    );
    try {
      const source = join(directory, 'preview.mp4');
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=640x360:r=30:d=12',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=12',
        '-c:v',
        'h264_videotoolbox',
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
      await withEditor(directory, directory, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('preview.mp4', { exact: true }).waitFor();
        const mediaState = () =>
          page.locator('video').evaluate((node) => {
            if (!(node instanceof HTMLVideoElement))
              throw new Error('Video element unavailable.');
            return {
              muted: node.muted,
              paused: node.paused,
              time: node.currentTime,
            };
          });
        await page
          .getByRole('button', { name: 'Mute preview', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .click();
        await page.waitForFunction(
          () => {
            const video = document.querySelector('video');
            return video && !video.paused && video.currentTime > 8.3;
          },
          undefined,
          { timeout: 20000 },
        );
        await page
          .getByRole('button', { name: 'Pause video', exact: true })
          .click();
        assert.equal((await mediaState()).muted, true);
        const seek = async (target: number) => {
          const start = performance.now();
          await page
            .getByRole('slider', { name: 'Video playhead' })
            .evaluate((node, value) => {
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
              )?.set;
              if (!setter) throw new Error('Range input setter unavailable.');
              setter.call(node, String(value));
              node.dispatchEvent(new Event('input', { bubbles: true }));
            }, target);
          await page
            .waitForFunction(
              (value) => {
                const video = document.querySelector('video');
                return (
                  video &&
                  video.readyState >= 2 &&
                  !video.seeking &&
                  Math.abs(video.currentTime - value) < 0.1
                );
              },
              target,
              { timeout: 10000 },
            )
            .catch(async (error: unknown) => {
              context.diagnostic(
                JSON.stringify(
                  await page.locator('video').evaluate((node, value) => {
                    if (!(node instanceof HTMLVideoElement))
                      throw new Error('Video element unavailable.');
                    return {
                      target: value,
                      time: node.currentTime,
                      duration: node.duration,
                      ready: node.readyState,
                      network: node.networkState,
                      buffered: Array.from(
                        { length: node.buffered.length },
                        (_, index) => [
                          node.buffered.start(index),
                          node.buffered.end(index),
                        ],
                      ),
                      error: node.error?.message,
                    };
                  }, target),
                ),
              );
              throw error;
            });
          return performance.now() - start;
        };
        context.diagnostic(
          `SDR seek milliseconds: ${await seek(5.2)}, ${await seek(1.1)}`,
        );
        await page
          .getByRole('slider', { name: 'Video playhead' })
          .evaluate(async (node) => {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value',
            )?.set;
            if (!setter) throw new Error('Range input setter unavailable.');
            for (const value of [8.8, 2.2, 6.1]) {
              setter.call(node, String(value));
              node.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise((done) => setTimeout(done, 60));
            }
          });
        await page.waitForFunction(() => {
          const video = document.querySelector('video');
          return (
            video &&
            video.readyState >= 2 &&
            !video.seeking &&
            Math.abs(video.currentTime - 6.1) < 0.1
          );
        });
        const paused = (await mediaState()).time;
        await page.waitForTimeout(300);
        assert.ok(Math.abs((await mediaState()).time - paused) < 0.01);
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .click();
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 30, y: 30 } });
        assert.equal((await mediaState()).paused, true);
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .fill('Preview does not change export');
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .press('Space');
        assert.equal((await mediaState()).paused, true);
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .press('Meta+Enter');
        await page.keyboard.press('Space');
        await page
          .getByRole('button', { name: 'Pause video', exact: true })
          .waitFor();
        await page.keyboard.press('Space');
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .waitFor();
        await startCurrentExport(page);
        await finishCurrentExport(page);
        const { stdout } = await execute(ffprobe, [
          '-v',
          'error',
          '-show_streams',
          '-of',
          'json',
          join(directory, 'preview_edited.mp4'),
        ]);
        const result = JSON.parse(stdout);
        assert.equal(
          result.streams.filter(
            (stream: { codec_type: string }) => stream.codec_type === 'audio',
          ).length,
          1,
        );
        assert.equal(
          result.streams.find(
            (stream: { codec_type: string }) => stream.codec_type === 'video',
          ).width,
          640,
        );
        assert.equal(await page.getByRole('alert').count(), 0);
        const tiny = join(directory, 'one-frame.mp4');
        await execute(ffmpeg, [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=blue:s=320x180:r=60',
          '-frames:v',
          '1',
          '-c:v',
          'h264_videotoolbox',
          tiny,
        ]);
        await page.getByLabel('Choose a video').setInputFiles(tiny);
        await page.getByText('one-frame.mp4', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Open one-frame.mp4', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .click();
        await page.waitForFunction(() => {
          const video = document.querySelector('video');
          return video && video.readyState >= 2 && video.videoWidth === 320;
        });
        assert.equal(await page.getByRole('alert').count(), 0);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'release acceptance measures painted text feedback and durable autosave',
  { timeout: 30000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-response-'));
    try {
      const source = join(directory, 'source.mp4');
      await fixture(source);
      await withEditor(directory, directory, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .fill('Measured text');
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .press('Meta+Enter');
        await page.getByText('Saved Locally', { exact: true }).waitFor();
        await page
          .getByRole('group', { name: 'Text box controls', exact: true })
          .focus();
        const timing = await page.evaluate(async () => {
          const control =
            document.querySelector<HTMLElement>('.text-selection');
          const text =
            document.querySelector<HTMLTextAreaElement>('.video-text');
          if (!control || !text)
            throw new Error('Text manipulation controls are unavailable.');
          const samples: number[] = [];
          let expectedX = parseFloat(text.style.left),
            committedAt = 0;
          for (let index = 0; index < 20; index++) {
            expectedX += 1;
            samples.push(
              await new Promise<number>((resolve, reject) => {
                const started = performance.now();
                const observer = new MutationObserver(() => {
                  if (parseFloat(text.style.left) !== expectedX) return;
                  observer.disconnect();
                  clearTimeout(timeout);
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() =>
                      resolve(performance.now() - started),
                    ),
                  );
                });
                const timeout = setTimeout(() => {
                  observer.disconnect();
                  reject(
                    new Error(
                      'A text nudge did not reach the rendered geometry.',
                    ),
                  );
                }, 1000);
                observer.observe(text, {
                  attributes: true,
                  attributeFilter: ['style'],
                });
                committedAt = Date.now();
                control.dispatchEvent(
                  new KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                  }),
                );
              }),
            );
          }
          samples.sort((a, b) => a - b);
          return {
            feedbackP95Ms: samples[Math.ceil(samples.length * 0.95) - 1]!,
            expectedX,
            committedAt,
          };
        });
        assert.ok(
          timing.feedbackP95Ms <= 100,
          `Visible feedback p95: ${timing.feedbackP95Ms}ms`,
        );
        while (true) {
          const saved = SavedWorkspaceSchema.parse(
            JSON.parse(
              await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
            ),
          );
          if (saved.workspace.entries[0]?.text?.box.x === timing.expectedX)
            break;
          assert.ok(
            Date.now() - timing.committedAt <= 1000,
            'Autosave exceeded one second after the last committed edit.',
          );
          await page.waitForTimeout(20);
        }
        const autosaveMs = Date.now() - timing.committedAt;
        assert.ok(autosaveMs <= 1000, `Durable autosave: ${autosaveMs}ms`);
        context.diagnostic(
          JSON.stringify({ feedbackP95Ms: timing.feedbackP95Ms, autosaveMs }),
        );
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  '4K60 preview benchmark keeps a 30-minute HDR source seekable with bounded memory',
  {
    timeout: 180000,
    skip: process.env.VIDEO_EDITOR_PREVIEW_BENCHMARK !== '1',
  },
  async (context) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-4k60-preview-'),
    );
    try {
      const seed = join(directory, 'seed.mp4');
      const source = join(directory, 'long-hlg.mp4');
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=3840x2160:r=60:d=2',
        '-vf',
        'setparams=range=limited:color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc',
        '-c:v',
        'hevc_videotoolbox',
        '-profile:v',
        'main10',
        '-pix_fmt',
        'p010le',
        '-b:v',
        '2M',
        '-g',
        '120',
        '-tag:v',
        'hvc1',
        '-color_primaries',
        'bt2020',
        '-color_trc',
        'arib-std-b67',
        '-colorspace',
        'bt2020nc',
        seed,
      ]);
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-stream_loop',
        '899',
        '-i',
        seed,
        '-t',
        '1800',
        '-map',
        '0:v:0',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        source,
      ]);
      const { stdout } = await execute(ffprobe, [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        source,
      ]);
      const sourceInfo = z
        .object({
          streams: z.array(
            z.object({
              width: z.number(),
              height: z.number(),
              nb_frames: z.coerce.number(),
              avg_frame_rate: z.string(),
            }),
          ),
          format: z.object({
            duration: z.coerce.number(),
            size: z.coerce.number(),
          }),
        })
        .parse(JSON.parse(stdout));
      assert.equal(sourceInfo.streams[0]?.width, 3840);
      assert.equal(sourceInfo.streams[0]?.height, 2160);
      assert.equal(sourceInfo.streams[0]?.nb_frames, 108000);
      assert.equal(sourceInfo.streams[0]?.avg_frame_rate, '60/1');
      assert.equal(sourceInfo.format.duration, 1800);
      const packaged = process.env.VIDEO_EDITOR_PACKAGED_APP;
      const check = async (page: Page, parent: number) => {
        await page
          .getByText('Bundled resources verified', { exact: true })
          .waitFor();
        const imported = performance.now();
        if (packaged)
          await setNativeFiles(page, 'input[aria-label="Choose a video"]', [
            source,
          ]);
        else await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('long-hlg.mp4', { exact: true }).waitFor();
        await page.waitForFunction(() => {
          const poster = document.querySelector('.video-poster');
          return (
            poster instanceof HTMLImageElement &&
            poster.complete &&
            poster.naturalWidth > 0
          );
        });
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 30, y: 30 } });
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .fill('4K60 placement');
        const importToEditableMs = performance.now() - imported;
        assert.ok(
          importToEditableMs <= 2000,
          `Import to editable: ${importToEditableMs}ms`,
        );
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .press('Meta+Enter');
        const originalGeometry = await geometry(page);
        const latencies: number[] = [];
        let peakDecoders = 0,
          peakDecoderRssKiB = 0;
        const sampleWorkers = async () => {
          const { stdout: processes } = await execute('/bin/ps', [
            '-axo',
            'pid=,ppid=,rss=,comm=',
          ]);
          const rows = processes.split('\n').flatMap((line) => {
            const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
            return match
              ? [
                  {
                    pid: Number(match[1]),
                    parent: Number(match[2]),
                    rss: Number(match[3]),
                    command: match[4] ?? '',
                  },
                ]
              : [];
          });
          const descendants = new Set([parent]);
          let previous = 0;
          while (previous !== descendants.size) {
            previous = descendants.size;
            rows
              .filter((row) => descendants.has(row.parent))
              .forEach((row) => descendants.add(row.pid));
          }
          const owned = rows
            .filter(
              (row) =>
                descendants.has(row.pid) && row.command.endsWith('/ffmpeg'),
            )
            .map((row) => row.rss);
          peakDecoders = Math.max(peakDecoders, owned.length);
          peakDecoderRssKiB = Math.max(peakDecoderRssKiB, ...owned);
          assert.ok(
            owned.length <= 1,
            'Only one owned native preview decoder may remain active.',
          );
          return owned.length;
        };
        for (const target of [
          0.13, 87.23, 601.57, 1789.72, 42.37, 1300.19, 911.81, 19.41, 1770.29,
          555.53, 1100.67, 301.11, 1500.43, 61.89, 1600.31, 710.71, 1000.17,
          7.61, 1700.59, 850.37,
        ]) {
          const seeking = page.evaluate(
            (value) =>
              new Promise<number>((resolveSeek, reject) => {
                const video = document.querySelector('video');
                const input = document.querySelector(
                  'input[aria-label="Video playhead"]',
                );
                const setter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  'value',
                )?.set;
                if (!video || !(input instanceof HTMLInputElement) || !setter) {
                  reject(new Error('Preview controls unavailable.'));
                  return;
                }
                const started = performance.now();
                let handle = 0;
                const limit = setTimeout(() => {
                  video.cancelVideoFrameCallback(handle);
                  reject(
                    new Error(
                      `Seek ${value} did not present a frame within 4 seconds.`,
                    ),
                  );
                }, 4000);
                const frame: VideoFrameRequestCallback = (now, metadata) => {
                  if (
                    !video.seeking &&
                    Math.abs(metadata.mediaTime - value) < 0.1
                  ) {
                    clearTimeout(limit);
                    resolveSeek(now - started);
                  } else handle = video.requestVideoFrameCallback(frame);
                };
                handle = video.requestVideoFrameCallback(frame);
                setter.call(input, String(value));
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }),
            target,
          );
          await sampleWorkers();
          latencies.push(await seeking);
        }
        const sorted = [...latencies].sort((a, b) => a - b);
        const seekP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
        context.diagnostic(
          JSON.stringify({ importToEditableMs, seekP95Ms, latencies }),
        );
        assert.ok(
          seekP95Ms !== undefined && seekP95Ms <= 1000,
          `Seek p95: ${seekP95Ms}ms`,
        );
        await page
          .getByRole('button', { name: 'Mute preview', exact: true })
          .click();
        const before = await page.locator('video').evaluate((node) => {
          if (!(node instanceof HTMLVideoElement))
            throw new Error('Video element unavailable.');
          return {
            time: node.currentTime,
            frames: node.getVideoPlaybackQuality().totalVideoFrames,
          };
        });
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .click();
        let peakBufferedSeconds = 0;
        for (let second = 0; second < 18; second += 1) {
          await page.waitForTimeout(1000);
          await sampleWorkers();
          const buffered = await page.locator('video').evaluate((node) => {
            if (!(node instanceof HTMLVideoElement))
              throw new Error('Video element unavailable.');
            return node.buffered.length
              ? node.buffered.end(node.buffered.length - 1) -
                  node.buffered.start(0)
              : 0;
          });
          peakBufferedSeconds = Math.max(peakBufferedSeconds, buffered);
        }
        await page
          .getByRole('button', { name: 'Pause video', exact: true })
          .click();
        const after = await page.locator('video').evaluate((node) => {
          if (!(node instanceof HTMLVideoElement))
            throw new Error('Video element unavailable.');
          return {
            time: node.currentTime,
            frames: node.getVideoPlaybackQuality().totalVideoFrames,
            width: node.videoWidth,
            height: node.videoHeight,
          };
        });
        assert.ok(
          after.time - before.time >= 17,
          'Playback must follow the original timeline across preview windows.',
        );
        assert.ok(
          (after.frames - before.frames) / (after.time - before.time) <= 16,
        );
        assert.ok(
          peakBufferedSeconds <= 14,
          `Buffered ${peakBufferedSeconds}s`,
        );
        assert.ok(peakDecoders === 1);
        assert.deepEqual([after.width, after.height], [360, 202]);
        assert.deepEqual(await geometry(page), originalGeometry);
        assert.equal(await page.getByRole('alert').count(), 0);
        context.diagnostic(
          JSON.stringify({
            source: sourceInfo,
            importToEditableMs,
            seekP95Ms,
            latencies,
            peakBufferedSeconds,
            peakDecoders,
            peakDecoderRssKiB,
            playbackSeconds: after.time - before.time,
          }),
        );
        await startCurrentExport(page, !packaged);
        const encoderDeadline = performance.now() + 15000;
        while (!(await sampleWorkers())) {
          assert.ok(
            performance.now() < encoderDeadline,
            'The long-video export did not start its native encoder.',
          );
          await page.waitForTimeout(20);
        }
        const cancelling = performance.now();
        const acknowledgementMs = await acknowledgeCancellation(page);
        assert.ok(
          acknowledgementMs <= 250,
          `Long-video cancellation acknowledgement: ${acknowledgementMs}ms`,
        );
        await page
          .getByRole('dialog', { name: 'Export results', exact: true })
          .waitFor({ timeout: 5000 });
        const stopMs = performance.now() - cancelling;
        assert.ok(stopMs <= 5000, `Long-video renderer stop: ${stopMs}ms`);
        assert.equal(await sampleWorkers(), 0);
        assert.deepEqual((await readdir(directory)).sort(), [
          'long-hlg.mp4',
          'profile',
          'seed.mp4',
        ]);
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        context.diagnostic(JSON.stringify({ acknowledgementMs, stopMs }));
      };
      if (packaged) {
        const profile = join(directory, 'profile');
        await mkdir(profile);
        await writeFile(
          join(profile, 'workspace.json'),
          JSON.stringify({
            version: 2,
            workspace: emptyWorkspace(),
            sources: {},
            outputFolder: directory,
          }),
        );
        await withPackagedApp(
          packaged,
          profile,
          async (page, _browser, child) => {
            assert.ok(child.pid);
            await check(page, child.pid);
          },
        );
      } else {
        await withEditor(directory, directory, async (page, application) => {
          const pid = application.process().pid;
          assert.ok(pid);
          await check(page, pid);
        });
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test(
  'failed imports, unsupported HDR, cancellation and changed originals leave the workspace safe',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-failure-proof-'),
    );
    const destination = join(directory, 'exports');
    try {
      await mkdir(destination);
      const source = join(directory, 'original.mp4');
      const corrupt = join(directory, 'corrupt.mp4');
      const hdr = join(directory, 'unsupported-hdr.mp4');
      await fixture(source);
      await writeFile(corrupt, 'not a video');
      await execute(ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=black:s=320x180:r=25:d=0.5',
        '-vf',
        'setparams=range=limited:color_primaries=bt709:color_trc=arib-std-b67:colorspace=bt2020nc',
        '-c:v',
        'hevc_videotoolbox',
        '-profile:v',
        'main10',
        '-pix_fmt',
        'p010le',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'arib-std-b67',
        '-colorspace',
        'bt2020nc',
        hdr,
      ]);
      await withEditor(directory, destination, async (page) => {
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('original.mp4', { exact: true }).waitFor();
        await page
          .locator('.video-source-layer')
          .click({ position: { x: 30, y: 30 } });
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await input.fill('Keep this text');
        await input.press('Meta+Enter');
        const unchanged = await geometry(page);
        for (const file of [corrupt, hdr]) {
          await page.getByLabel('Choose a video').setInputFiles(file);
          const error = page.getByRole('alert');
          await error.waitFor();
          if (file === hdr)
            assert.match(await error.innerText(), /HDR input needs tagged/);
          assert.deepEqual(await geometry(page), unchanged);
          assert.equal(await input.inputValue(), 'Keep this text');
          await page.getByText('original.mp4', { exact: true }).waitFor();
          await page
            .getByRole('button', { name: 'Dismiss error', exact: true })
            .click();
        }
        await page
          .locator('.app-toolbar')
          .getByText('Export current', { exact: true })
          .click();
        await page
          .getByRole('dialog', { name: 'Export preflight', exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole('spinbutton', { name: 'Font size', exact: true })
            .isDisabled(),
          true,
        );
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.deepEqual(await readdir(destination), []);
        assert.deepEqual(await geometry(page), unchanged);
        await writeFile(
          source,
          Buffer.concat([
            await readFile(source),
            Buffer.from('source-changed'),
          ]),
        );
        await page
          .locator('.app-toolbar')
          .getByText('Export current', { exact: true })
          .click();
        await page
          .getByRole('alert')
          .filter({ hasText: 'original video changed' })
          .waitFor();
        assert.deepEqual(await readdir(destination), []);
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);
