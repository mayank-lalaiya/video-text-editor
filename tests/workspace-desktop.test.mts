import assert from 'node:assert/strict';
import { startCurrentExport, finishCurrentExport } from './export-helpers.mts';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { _electron, type ElectronApplication } from 'playwright-core';
import { SavedWorkspaceSchema } from '../src/main/workspace/store.ts';
import { QueueResultSchema } from '../src/shared/export-queue.ts';

const root = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);
const ffmpeg = join(root, 'resources/media-tools/darwin-arm64/ffmpeg');
const electron = createRequire(import.meta.url)('electron') as string;
declare global {
  var workspaceCleanupGate:
    | { entered: boolean; release: (() => void) | null }
    | undefined;
}
test(
  'Apply to All maps, plays and exports independent copies; group history and detached import defaults survive the full workflow',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-apply-all-'));
    let app: ElectronApplication | undefined;
    try {
      for (const [name, size] of [
        ['source', '1080x1920'],
        ['doubled', '2160x3840'],
        ['mixed', '640x360'],
      ] as const) {
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=black:s=${size}:r=5:d=0.6`,
          '-c:v',
          'h264_videotoolbox',
          join(directory, `${name}.mp4`),
        ]);
      }
      const source = join(directory, 'source.mp4');
      for (const name of ['custom', 'whitespace'])
        await copyFile(source, join(directory, `${name}.mp4`));
      const launched = await launch(directory);
      app = launched.app;
      let page = launched.page;
      const activate = async (name: string) => {
        await page
          .getByRole('button', { name: `Open ${name}.mp4`, exact: true })
          .click();
      };
      const setText = async (value: string) => {
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        if (await input.count())
          await page
            .getByRole('group', { name: 'Text box controls', exact: true })
            .dblclick();
        else
          await page
            .getByRole('button', { name: 'Add text', exact: true })
            .click();
        await input.fill(value);
        await input.press('Meta+Enter');
      };
      const saved = async () => {
        await page.getByText('Saved Locally', { exact: true }).waitFor();
        return SavedWorkspaceSchema.parse(
          JSON.parse(
            await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
          ),
        );
      };
      const importOne = async (name: string) => {
        const path = join(directory, `${name}.mp4`);
        await copyFile(source, path);
        await page.getByLabel('Choose a video').setInputFiles(path);
        await page
          .getByRole('button', { name: `Open ${name}.mp4`, exact: true })
          .waitFor();
      };
      const inheritance = () =>
        page.getByLabel('Auto-apply to new imports', { exact: true });
      await page
        .getByLabel('Choose a video')
        .setInputFiles(
          ['source', 'doubled', 'custom', 'whitespace', 'mixed'].map((name) =>
            join(directory, `${name}.mp4`),
          ),
        );
      await page.getByText('5 video(s) imported.', { exact: true }).waitFor();
      assert.ok(await inheritance().isDisabled());
      await activate('custom');
      await setText('Custom stays');
      await activate('whitespace');
      await setText(' \n\t');
      await activate('source');
      await setText('One 👍🏽\nTwo');
      for (const [label, value] of [
        ['Font size', '50.5'],
        ['X', '108.125'],
        ['Y', '192.25'],
        ['Width', '540.5'],
        ['Height', '220.75'],
      ] as const)
        await page
          .getByRole('spinbutton', { name: label, exact: true })
          .fill(value);
      await page
        .getByRole('spinbutton', { name: 'Height', exact: true })
        .press('Tab');
      const before = await saved();
      const sourceBox = before.workspace.entries[0]!.text!.box;
      await page
        .getByRole('button', { name: 'Apply to all', exact: true })
        .click();
      await page
        .getByText(/3 video\(s\) filled\. 1 existing-text video\(s\) preserved/)
        .waitFor();
      let snapshot = await saved();
      assert.equal(snapshot.version, 2);
      assert.deepEqual(snapshot.workspace.entries[0]!.text!.box, sourceBox);
      const doubled = snapshot.workspace.entries[1]!.text!.box;
      for (const key of [
        'x',
        'y',
        'width',
        'height',
        'fontSize',
        'padding',
      ] as const)
        assert.equal(doubled[key], sourceBox[key] * 2, key);
      assert.equal(
        snapshot.workspace.entries[2]?.text?.box.text,
        'Custom stays',
      );
      assert.ok(snapshot.workspace.entries.every((entry) => !entry.checked));
      assert.ok(await inheritance().isChecked());
      await page.getByText(/1 aspect\/pixel-ratio copy\/copies/).waitFor();
      await activate('mixed');
      await page
        .getByRole('spinbutton', { name: 'Font size', exact: true })
        .focus();
      await page
        .getByRole('spinbutton', { name: 'Font size', exact: true })
        .press('Tab');
      assert.equal(await page.getByRole('alert').count(), 0);
      snapshot = await saved();
      assert.equal(
        snapshot.workspace.entries[4]?.text?.box.fontSize,
        (sourceBox.fontSize * 360) / 1920,
      );
      await activate('doubled');
      await page
        .getByRole('button', { name: 'Play video', exact: true })
        .click();
      await page.waitForFunction(
        () => (document.querySelector('video')?.currentTime ?? 0) > 0.1,
      );
      await page.getByLabel('Export doubled.mp4', { exact: true }).check();
      await page
        .getByRole('button', { name: 'Undo Apply to all', exact: true })
        .click();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .count(),
        0,
      );
      assert.ok(
        await page
          .getByLabel('Export doubled.mp4', { exact: true })
          .isChecked(),
      );
      assert.ok(await inheritance().isDisabled());
      await page
        .getByRole('button', { name: 'Redo Apply to all', exact: true })
        .click();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'One 👍🏽\nTwo',
      );
      const exports = join(directory, 'exports');
      await mkdir(exports);
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folder],
        });
      }, exports);
      await startCurrentExport(page);
      assert.ok(
        await page
          .getByRole('button', { name: 'Apply to all', exact: true })
          .isDisabled(),
      );
      assert.ok(await inheritance().isDisabled());
      await finishCurrentExport(page);
      const output = join(
        exports,
        (await readdir(exports)).find((name) => name.endsWith('.mp4'))!,
      );
      const pixels = await execute(
        ffmpeg,
        [
          '-v',
          'error',
          '-i',
          output,
          '-vf',
          `crop=${Math.ceil(doubled.width)}:${Math.ceil(doubled.height)}:${Math.floor(doubled.x)}:${Math.floor(doubled.y)},format=gray`,
          '-frames:v',
          '1',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
      );
      assert.ok(
        pixels.stdout.filter((value) => value > 200).length > 100,
        'Actual doubled-resolution export must contain rendered glyphs in the copied box.',
      );
      await activate('source');
      await setText('Later source edit');
      assert.equal(
        (await saved()).workspace.textDefault?.box.text,
        'One 👍🏽\nTwo',
      );
      await importOne('later');
      await activate('later');
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'One 👍🏽\nTwo',
      );
      await activate('doubled');
      await page
        .getByRole('button', { name: 'Delete text', exact: true })
        .click();
      await inheritance().uncheck();
      await importOne('off');
      await inheritance().check();
      assert.equal(
        (await saved()).workspace.entries.find(
          (entry) => entry.asset.name === 'off.mp4',
        )?.text,
        null,
      );
      await importOne('on');
      assert.equal(
        (await saved()).workspace.entries.find(
          (entry) => entry.asset.name === 'on.mp4',
        )?.text?.box.text,
        'One 👍🏽\nTwo',
      );
      await inheritance().uncheck();
      await activate('source');
      await page
        .getByRole('button', { name: 'Apply to all', exact: true })
        .click();
      snapshot = await saved();
      assert.equal(snapshot.workspace.textDefault?.enabled, false);
      assert.equal(
        snapshot.workspace.textDefault?.box.text,
        'Later source edit',
      );
      assert.equal(
        snapshot.workspace.entries[1]?.text?.box.text,
        'Later source edit',
      );
      assert.equal(
        snapshot.workspace.entries[2]?.text?.box.text,
        'Custom stays',
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal(
        (await saved()).workspace.textDefault?.box.text,
        'One 👍🏽\nTwo',
      );
      await page.keyboard.press('Meta+Shift+z');
      assert.equal(
        (await saved()).workspace.textDefault?.box.text,
        'Later source edit',
      );
      await activate('whitespace');
      await page
        .getByRole('button', { name: 'Delete text', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Remove source.mp4', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Open source.mp4', exact: true })
        .waitFor({ state: 'detached' });
      assert.equal(
        (await saved()).workspace.textDefault?.box.text,
        'Later source edit',
      );
      await app.close();
      app = undefined;
      const reopened = await launch(directory);
      app = reopened.app;
      page = reopened.page;
      await activate('whitespace');
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .count(),
        0,
      );
      assert.equal(await inheritance().isChecked(), false);
      await inheritance().check();
      await importOne('after-removal');
      await activate('after-removal');
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'Later source edit',
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await saved()).workspace.textDefault?.box.text,
        'Later source edit',
      );
      await page
        .getByRole('button', { name: 'Clear workspace', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'No videos yet', exact: true })
        .waitFor();
      assert.equal((await saved()).workspace.textDefault, null);
      assert.ok(await inheritance().isDisabled());
    } finally {
      if (app) await app.close();
      await rm(directory, { recursive: true });
    }
  },
);
async function launch(directory: string, waitReady = true) {
  const app = await _electron.launch({
    executablePath: electron,
    args: [root, `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VIDEO_EDITOR_TEST_BACKGROUND: '1' },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  if (waitReady)
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Choose a video"]',
        )?.disabled === false,
    );
  else
    await page
      .getByRole('alert')
      .filter({ hasText: 'Workspace could not be restored' })
      .waitFor();
  assert.ok(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (window) => !window.isVisible() && !window.isFocused(),
      ),
    ),
  );
  return { app, page };
}
async function fixture(path: string, hdr = false) {
  await execute(ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=320x180:r=25:d=2${hdr ? ',format=p010le' : ''}`,
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
async function interceptPosterCleanup(app: ElectronApplication, fail: boolean) {
  await app.evaluate((_electron, fail) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const original = fs.rm;
    const gate: {
      entered: boolean;
      release: (() => void) | null;
    } = { entered: false, release: null };
    globalThis.workspaceCleanupGate = gate;
    fs.rm = async (...args) => {
      if (typeof args[0] === 'string' && args[0].endsWith('.png')) {
        fs.rm = original;
        gate.entered = true;
        if (fail) throw new Error('Simulated cached poster cleanup failure.');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 30000);
          gate.release = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
      }
      return original(...args);
    };
  }, fail);
}
async function waitForPosterCleanup(app: ElectronApplication) {
  await app.evaluate(async () => {
    const start = Date.now();
    while (!globalThis.workspaceCleanupGate?.entered) {
      if (Date.now() - start > 5000)
        throw new Error('Poster cleanup did not start.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}
for (const action of ['remove', 'clear'] as const) {
  test(
    `closing during slow ${action} waits for the committed workspace and cannot resurrect entries or defaults`,
    { timeout: 45000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'video-editor-remove-close-'),
      );
      let app: ElectronApplication | undefined;
      try {
        const source = join(directory, 'source.mp4');
        await fixture(source);
        const launched = await launch(directory);
        app = launched.app;
        const page = launched.page;
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        const text = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await text.fill('Remove only once');
        await text.press('Meta+Enter');
        await page
          .getByRole('button', { name: 'Apply to all', exact: true })
          .click();
        await page.getByText('Saved Locally', { exact: true }).waitFor();
        await interceptPosterCleanup(app, false);
        await page
          .getByRole('button', {
            name: action === 'remove' ? 'Remove source.mp4' : 'Clear workspace',
            exact: true,
          })
          .click();
        await waitForPosterCleanup(app);
        await page
          .getByText('Updating workspace...', { exact: true })
          .waitFor();
        assert.ok(
          await page
            .getByRole('button', { name: 'Apply to all', exact: true })
            .isDisabled(),
        );
        assert.ok(
          await page.getByLabel('Auto-apply to new imports').isDisabled(),
        );
        await page.keyboard.press('Meta+z');
        assert.equal(await text.inputValue(), 'Remove only once');
        const closed = page.waitForEvent('close');
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.close(),
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(
          page.isClosed(),
          false,
          'Close must await pending cleanup and the renderer update.',
        );
        await app.evaluate(() => globalThis.workspaceCleanupGate?.release?.());
        await closed;
        await app.close();
        app = undefined;
        const disk = SavedWorkspaceSchema.parse(
          JSON.parse(
            await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
          ),
        );
        assert.equal(disk.workspace.entries.length, 0);
        assert.equal(disk.workspace.textDefault !== null, action === 'remove');
        const reopened = await launch(directory);
        app = reopened.app;
        await reopened.page
          .getByRole('heading', { name: 'No videos yet', exact: true })
          .waitFor();
        assert.equal(
          await reopened.page
            .getByLabel('Auto-apply to new imports')
            .isChecked(),
          action === 'remove',
        );
      } finally {
        if (app) {
          await app.evaluate(() =>
            globalThis.workspaceCleanupGate?.release?.(),
          );
          await app.close();
        }
        await rm(directory, { recursive: true });
      }
    },
  );
  test(
    `${action} reports failed cached-poster cleanup, keeps saved and visible entries consistent and permits reimport`,
    { timeout: 45000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'video-editor-remove-warning-'),
      );
      let app: ElectronApplication | undefined;
      try {
        const source = join(directory, 'source.mp4');
        const other = join(directory, 'other.mp4');
        await fixture(source);
        await copyFile(source, other);
        const launched = await launch(directory);
        app = launched.app;
        const page = launched.page;
        await page.getByLabel('Choose a video').setInputFiles([source, other]);
        await page.getByText('2 video(s) imported.', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        const text = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await text.fill('Saved removal with an explicit cleanup warning');
        await text.press('Meta+Enter');
        await page
          .getByRole('button', { name: 'Apply to all', exact: true })
          .click();
        await page.getByText('Saved Locally', { exact: true }).waitFor();
        await interceptPosterCleanup(app, true);
        await page
          .getByRole('button', {
            name: action === 'remove' ? 'Remove source.mp4' : 'Clear workspace',
            exact: true,
          })
          .click();
        await page
          .getByText(/Workspace change saved; original media is unchanged/)
          .waitFor();
        await page.getByText('Saved Locally', { exact: true }).waitFor();
        const disk = SavedWorkspaceSchema.parse(
          JSON.parse(
            await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
          ),
        );
        assert.equal(
          disk.workspace.entries.length,
          action === 'remove' ? 1 : 0,
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'Open source.mp4', exact: true })
            .count(),
          0,
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'Open other.mp4', exact: true })
            .count(),
          action === 'remove' ? 1 : 0,
        );
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page.getByText('1 video(s) imported.', { exact: true }).waitFor();
        await page
          .getByRole('button', { name: 'Open source.mp4', exact: true })
          .waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
      } finally {
        if (app) await app.close();
        await rm(directory, { recursive: true });
      }
    },
  );
}
test(
  'a timed-out close remains usable after pending removal completes',
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-remove-close-timeout-'),
    );
    let app: ElectronApplication | undefined;
    try {
      const source = join(directory, 'source.mp4');
      await fixture(source);
      const launched = await launch(directory);
      app = launched.app;
      const page = launched.page;
      await page.getByLabel('Choose a video').setInputFiles(source);
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      const text = page.getByRole('textbox', {
        name: 'Video text',
        exact: true,
      });
      await text.fill('Wait safely for removal');
      await text.press('Meta+Enter');
      await page.getByText('Saved Locally', { exact: true }).waitFor();
      await interceptPosterCleanup(app, false);
      await page
        .getByRole('button', { name: 'Remove source.mp4', exact: true })
        .click();
      await waitForPosterCleanup(app);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.close(),
      );
      await new Promise((resolve) => setTimeout(resolve, 15250));
      assert.equal(page.isClosed(), false);
      await app.evaluate(() => globalThis.workspaceCleanupGate?.release?.());
      await page
        .getByRole('heading', { name: 'No videos yet', exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>(
            'input[aria-label="Choose a video"]',
          )?.disabled === false,
      );
      await page.getByLabel('Choose a video').setInputFiles(source);
      await page.getByText('1 video(s) imported.', { exact: true }).waitFor();
    } finally {
      if (app) {
        await app.evaluate(() => globalThis.workspaceCleanupGate?.release?.());
        await app.close();
      }
      await rm(directory, { recursive: true });
    }
  },
);
test(
  'pixel-shape copies warn about reflow; compact rows remain clickable and an empty collection can clear its default',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-pixel-shape-'),
    );
    let app: ElectronApplication | undefined;
    try {
      for (const [name, size, sar] of [
        ['anamorphic', '320x240', '4/3'],
        ['square', '640x360', '1'],
      ] as const)
        await execute(ffmpeg, [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=black:s=${size}:r=5:d=0.6`,
          '-vf',
          `setsar=${sar}`,
          '-c:v',
          'h264_videotoolbox',
          join(directory, `${name}.mp4`),
        ]);
      const launched = await launch(directory);
      app = launched.app;
      const page = launched.page;
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setSize(1100, 700),
      );
      await page
        .getByLabel('Choose a video')
        .setInputFiles(
          ['anamorphic', 'square'].map((name) =>
            join(directory, `${name}.mp4`),
          ),
        );
      await page.getByText('2 video(s) imported.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      const text = page.getByRole('textbox', {
        name: 'Video text',
        exact: true,
      });
      await text.fill('MMMMMMMMMMMMMMMM');
      await text.press('Meta+Enter');
      await page
        .getByRole('spinbutton', { name: 'Font size', exact: true })
        .fill('24');
      await page
        .getByRole('spinbutton', { name: 'Width', exact: true })
        .fill('150');
      await page
        .getByRole('spinbutton', { name: 'Width', exact: true })
        .press('Tab');
      const lines = () =>
        text.evaluate((input: HTMLTextAreaElement) => {
          const clone = input.cloneNode(true) as HTMLTextAreaElement;
          clone.value = input.value;
          Object.assign(clone.style, {
            position: 'fixed',
            visibility: 'hidden',
            height: '0px',
          });
          document.body.append(clone);
          const css = getComputedStyle(clone);
          const count = Math.round(
            (clone.scrollHeight -
              parseFloat(css.paddingTop) -
              parseFloat(css.paddingBottom)) /
              parseFloat(css.lineHeight),
          );
          clone.remove();
          return count;
        });
      assert.equal(await lines(), 3);
      await page
        .getByRole('button', { name: 'Apply to all', exact: true })
        .click();
      await page.getByText(/1 aspect\/pixel-ratio copy\/copies/).waitFor();
      await page
        .getByRole('button', { name: 'Open square.mp4', exact: true })
        .click();
      assert.equal(await lines(), 2);
      const later = join(directory, 'later.mp4');
      await copyFile(join(directory, 'square.mp4'), later);
      await page.getByLabel('Choose a video').setInputFiles(later);
      await page
        .getByText(
          /Review inherited text wrapping for aspect\/pixel-ratio differences: later.mp4/,
        )
        .waitFor();
      for (const name of ['anamorphic', 'square', 'later']) {
        await page
          .getByRole('button', { name: `Remove ${name}.mp4`, exact: true })
          .click();
        await page
          .getByRole('button', { name: `Open ${name}.mp4`, exact: true })
          .waitFor({ state: 'detached' });
      }
      assert.ok(
        await page
          .getByRole('button', { name: 'Clear workspace', exact: true })
          .isEnabled(),
      );
      assert.ok(await page.getByLabel('Auto-apply to new imports').isChecked());
      await page
        .getByRole('button', { name: 'Clear workspace', exact: true })
        .click();
      await page.getByText('Saved Locally', { exact: true }).waitFor();
      assert.ok(
        await page.getByLabel('Auto-apply to new imports').isDisabled(),
      );
      const disk = SavedWorkspaceSchema.parse(
        JSON.parse(
          await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
        ),
      );
      assert.equal(disk.workspace.textDefault, null);
      assert.deepEqual(disk.workspace.entries, []);
    } finally {
      if (app) await app.close();
      await rm(directory, { recursive: true });
    }
  },
);
async function attemptSecondInstance(directory: string) {
  const child = spawn(
    electron,
    [root, `--user-data-dir=${join(directory, 'profile')}`],
    {
      env: { ...process.env, VIDEO_EDITOR_TEST_BACKGROUND: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let output = '';
  child.stderr.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Second instance did not exit: ${output}`)),
        10000,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(
            new Error(`Second instance exited ${code}/${signal}: ${output}`),
          );
      });
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((resolve) =>
        child.once('exit', () => resolve()),
      );
      child.kill('SIGTERM');
      await stopped;
    }
  }
}
test(
  'relink preserves edits and checks made during hashing, including history and relaunch',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-relink-race-'),
    );
    let app: ElectronApplication | undefined;
    try {
      const source = join(directory, 'source.mp4');
      await fixture(source);
      const handle = await open(source, 'r+');
      try {
        const { size } = await handle.stat();
        const atomSize = 2 * 1024 * 1024 * 1024;
        const header = Buffer.alloc(8);
        header.writeUInt32BE(atomSize);
        header.write('free', 4);
        // A sparse MP4 free atom gives the full-file hash real work without allocating gigabytes.
        await handle.write(header, 0, header.length, size);
        await handle.truncate(size + atomSize);
      } finally {
        await handle.close();
      }
      const first = await launch(directory);
      app = first.app;
      const page = first.page;
      const input = page.getByRole('textbox', {
        name: 'Video text',
        exact: true,
      });
      const controls = page.getByRole('group', {
        name: 'Text box controls',
        exact: true,
      });
      const locate = page.getByLabel('Locate source.mp4', { exact: true });
      await page.getByLabel('Choose a video').setInputFiles(source);
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      await input.fill('Before relink');
      await input.press('Meta+Enter');
      await page.getByText('Saved Locally', { exact: true }).waitFor();
      await controls.dblclick();
      await locate.setInputFiles(source);
      if ((await input.getAttribute('readonly')) !== null)
        await controls.dblclick();
      await input.fill('Edited during relink');
      await input.press('Meta+Enter');
      await page.getByLabel('Export source.mp4', { exact: true }).check();
      assert.ok(
        await locate.isDisabled(),
        'Edits must occur before relink finishes.',
      );
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>(
            'input[aria-label="Locate source.mp4"]',
          )?.disabled === false,
      );
      await page.getByText('Saved Locally', { exact: true }).waitFor();
      const saved = SavedWorkspaceSchema.parse(
        JSON.parse(
          await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
        ),
      );
      assert.equal(
        saved.workspace.entries[0]?.text?.box.text,
        'Edited during relink',
      );
      assert.equal(saved.workspace.entries[0]?.checked, true);
      assert.equal(await input.inputValue(), 'Edited during relink');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal(await input.inputValue(), 'Before relink');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      assert.equal(await input.inputValue(), 'Edited during relink');
      await app.close();
      app = undefined;
      const reopened = await launch(directory);
      app = reopened.app;
      assert.equal(
        await reopened.page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'Edited during relink',
      );
      assert.ok(
        await reopened.page
          .getByLabel('Export source.mp4', { exact: true })
          .isChecked(),
      );
    } finally {
      if (app) await app.close();
      await rm(directory, { recursive: true });
    }
  },
);
test(
  'a second instance cannot overwrite a saved workspace and reopens a closed primary window without activation in tests',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-single-instance-'),
    );
    let app: ElectronApplication | undefined;
    try {
      const source = join(directory, 'source.mp4');
      await fixture(source);
      const first = await launch(directory);
      app = first.app;
      await first.page.getByLabel('Choose a video').setInputFiles(source);
      await first.page
        .getByRole('button', { name: 'Add text', exact: true })
        .click();
      const input = first.page.getByRole('textbox', {
        name: 'Video text',
        exact: true,
      });
      await input.fill('Latest saved text');
      await input.press('Meta+Enter');
      await first.page.getByText('Saved Locally', { exact: true }).waitFor();
      const path = join(directory, 'profile/workspace.json');
      const saved = await readFile(path, 'utf8');
      await attemptSecondInstance(directory);
      assert.equal(await readFile(path, 'utf8'), saved);
      assert.equal(await input.inputValue(), 'Latest saved text');
      assert.ok(
        await app.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().length === 1 &&
            BrowserWindow.getAllWindows().every(
              (window) => !window.isVisible() && !window.isFocused(),
            ),
        ),
      );
      await Promise.all([
        first.page.waitForEvent('close'),
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.close(),
        ),
      ]);
      const reopening = app.waitForEvent('window');
      await attemptSecondInstance(directory);
      const page = await reopening;
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'Latest saved text',
      );
      assert.ok(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) => !window.isVisible() && !window.isFocused(),
          ),
        ),
      );
    } finally {
      if (app) await app.close();
      await rm(directory, { recursive: true });
    }
  },
);
test(
  '30 mixed clips import responsively; independent edits, order, checks, playheads and folder survive relaunch; recovery preserves text',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-collection-'));
    let app: ElectronApplication | undefined;
    try {
      const seed = join(directory, 'seed.mp4'),
        hdr = join(directory, 'hdr.mov');
      await fixture(seed);
      await fixture(hdr, true);
      const files: string[] = [];
      for (let index = 0; index < 30; index++) {
        const path = join(
          directory,
          `clip-${String(index).padStart(2, '0')}.${index % 2 ? 'mov' : 'mp4'}`,
        );
        await copyFile(index % 2 ? hdr : seed, path);
        files.push(path);
      }
      const corrupt = join(directory, 'bad.mp4');
      await writeFile(corrupt, 'not a video');
      const first = await launch(directory);
      app = first.app;
      let page = first.page;
      await page.evaluate(() => {
        const samples: number[] = [];
        let previous = performance.now();
        const timer = setInterval(() => {
          const now = performance.now();
          samples.push(now - previous);
          previous = now;
        }, 20);
        Object.assign(window, { responsiveness: { samples, timer } });
      });
      await page
        .getByLabel('Choose a video')
        .setInputFiles([...files, corrupt]);
      try {
        await page
          .getByText('30 video(s) imported.', { exact: true })
          .waitFor();
      } catch (error) {
        console.error(
          'Collection import failure:',
          await page.locator('.editor-notices').innerText(),
        );
        throw error;
      }
      assert.equal(await page.locator('.video-card').count(), 30);
      const timing = await page.evaluate(() => {
        const value = Reflect.get(window, 'responsiveness') as {
          samples: number[];
          timer: number;
        };
        clearInterval(value.timer);
        return {
          samples: value.samples.length,
          worst: Math.max(...value.samples),
        };
      });
      assert.ok(
        timing.samples >= 20 && timing.worst < 250,
        JSON.stringify(timing),
      );
      console.log('30-clip UI responsiveness:', JSON.stringify(timing));
      await page.getByRole('alert').filter({ hasText: 'bad.mp4' }).waitFor();
      await page
        .getByRole('button', { name: 'Dismiss error', exact: true })
        .click();
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .fill('First clip text');
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .press('Meta+Enter');
      await page.getByLabel('Export clip-01.mov', { exact: true }).check();
      assert.ok(
        await page
          .getByLabel('Select all for export', { exact: true })
          .evaluate(
            (node) => node instanceof HTMLInputElement && node.indeterminate,
          ),
      );
      assert.equal(
        await page
          .locator('.video-card[aria-current="true"] strong')
          .innerText(),
        'clip-00.mp4',
      );
      await page.getByRole('slider', { name: 'Video playhead' }).fill('0.8');
      await page.waitForFunction(
        () => document.querySelector('video')?.readyState === 4,
      );
      await page
        .getByRole('button', { name: 'Open clip-01.mov', exact: true })
        .click();
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .fill('Independent second text');
      await page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .press('Meta+Enter');
      await page
        .getByRole('button', { name: 'Open clip-00.mp4', exact: true })
        .click();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'First clip text',
      );
      assert.equal(
        await page
          .getByLabel('Export clip-01.mov', { exact: true })
          .isChecked(),
        true,
      );
      const restoredTime = Number(
        await page.getByRole('slider', { name: 'Video playhead' }).inputValue(),
      );
      assert.ok(
        Math.abs(restoredTime - 0.8) < 0.05,
        `Restored playhead was ${restoredTime}, expected 0.8.`,
      );
      await page.getByLabel('Choose a video').setInputFiles(files[0]!);
      await page
        .getByRole('alert')
        .filter({ hasText: 'Already imported' })
        .waitFor();
      assert.equal(await page.locator('.video-card').count(), 30);
      await page
        .getByRole('button', { name: 'Dismiss error', exact: true })
        .click();
      const exports = join(directory, 'exports');
      await mkdir(exports);
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [folder],
        });
      }, exports);
      await startCurrentExport(page);
      await finishCurrentExport(page);
      await page
        .getByRole('button', { name: 'Apply to all', exact: true })
        .click();
      await page.getByLabel('Select all for export', { exact: true }).check();
      await page
        .getByRole('button', { name: 'Export batch', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Export checked (30)', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: 'Export preflight', exact: true })
        .waitFor();
      const preflight = QueueResultSchema.parse(
        await page.evaluate(() =>
          window.desktop!.exportQueue({ type: 'status' }),
        ),
      );
      assert.ok(preflight.ok && preflight.state);
      assert.equal(preflight.state.jobs.length, 30);
      assert.ok(preflight.state.jobs.every((job) => job.status === 'ready'));
      await page
        .getByRole('button', { name: 'Start export', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: 'Export results', exact: true })
        .waitFor({ timeout: 120000 });
      const batch = QueueResultSchema.parse(
        await page.evaluate(() =>
          window.desktop!.exportQueue({ type: 'status' }),
        ),
      );
      assert.ok(batch.ok && batch.state);
      assert.equal(batch.state.jobs.length, 30);
      assert.ok(batch.state.jobs.every((job) => job.status === 'completed'));
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await app.close();
      app = undefined;
      const savedPath = join(directory, 'profile/workspace.json');
      let saved = SavedWorkspaceSchema.parse(
        JSON.parse(await readFile(savedPath, 'utf8')),
      );
      assert.equal(saved.workspace.entries.length, 30);
      assert.equal(saved.outputFolder, exports);
      assert.ok(Math.abs((saved.workspace.entries[0]?.time ?? 0) - 0.8) < 0.05);
      const moved = join(directory, 'relocated.mp4');
      await rename(files[0]!, moved);
      const second = await launch(directory);
      app = second.app;
      page = second.page;
      assert.equal(await page.locator('.video-card').count(), 30);
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'First clip text',
      );
      await page
        .getByRole('alert')
        .filter({ hasText: 'Source unavailable' })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Play video', exact: true })
          .isEnabled(),
        false,
      );
      await page
        .getByLabel('Locate clip-00.mp4', { exact: true })
        .setInputFiles(hdr);
      await page
        .getByRole('alert')
        .filter({ hasText: 'does not match the original' })
        .waitFor();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'First clip text',
      );
      await page
        .getByRole('button', { name: 'Dismiss error', exact: true })
        .click();
      await page
        .getByLabel('Locate clip-00.mp4', { exact: true })
        .setInputFiles(moved);
      await page
        .getByRole('button', { name: 'Open relocated.mp4', exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Open clip-01.mov', exact: true })
        .click();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'Independent second text',
      );
      assert.equal(
        await page
          .getByLabel('Export clip-01.mov', { exact: true })
          .isChecked(),
        true,
      );
      assert.ok(
        await page
          .locator('video')
          .evaluate((node) => node instanceof HTMLVideoElement && node.paused),
      );
      assert.equal(
        await page
          .getByRole('button', { name: 'Undo', exact: true })
          .isDisabled(),
        true,
        'History is session-local; saved text is restored without stale Undo steps.',
      );
      await page
        .getByRole('button', { name: 'Remove clip-01.mov', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Open clip-01.mov', exact: true })
        .waitFor({ state: 'detached' });
      assert.equal(await page.locator('.video-card').count(), 29);
      assert.ok((await readFile(files[1]!)).length > 0);
      await page
        .getByRole('button', { name: 'Clear workspace', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'No videos yet', exact: true })
        .waitFor();
      await app.close();
      app = undefined;
      saved = SavedWorkspaceSchema.parse(
        JSON.parse(await readFile(savedPath, 'utf8')),
      );
      assert.equal(saved.workspace.entries.length, 0);
      assert.equal(
        (await readdir(exports)).filter((name) => name.endsWith('.mp4')).length,
        31,
      );
      assert.ok((await readFile(moved)).length > 0);
    } finally {
      if (app) await app.close();
      await rm(directory, { recursive: true });
    }
  },
);
test(
  'save failure is persistent and retryable without losing current text or falsely showing Saved Locally',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-editor-save-ui-'));
    let app: ElectronApplication | undefined;
    const pending = join(directory, 'profile/workspace.json.pending');
    try {
      const source = join(directory, 'source.mp4');
      await fixture(source);
      const launched = await launch(directory);
      app = launched.app;
      const page = launched.page;
      await page.getByLabel('Choose a video').setInputFiles(source);
      await page.getByRole('button', { name: 'Add text', exact: true }).click();
      const input = page.getByRole('textbox', {
        name: 'Video text',
        exact: true,
      });
      await input.fill('Retain me');
      await input.press('Meta+Enter');
      await page.getByText('Saved Locally', { exact: true }).waitFor();
      await mkdir(pending);
      await page
        .getByRole('group', { name: 'Text box controls', exact: true })
        .dblclick();
      await input.fill('Still in memory');
      await input.press('Meta+Enter');
      await page
        .getByRole('alert')
        .filter({ hasText: 'Save Failed' })
        .waitFor();
      assert.equal(
        await page.getByText('Saved Locally', { exact: true }).count(),
        0,
      );
      assert.equal(await input.inputValue(), 'Still in memory');
      const saved = SavedWorkspaceSchema.parse(
        JSON.parse(
          await readFile(join(directory, 'profile/workspace.json'), 'utf8'),
        ),
      );
      assert.equal(saved.workspace.entries[0]?.text?.box.text, 'Retain me');
      await rm(pending, { recursive: true });
      await page
        .getByRole('button', { name: 'Retry Save', exact: true })
        .click();
      await page.getByText('Saved Locally', { exact: true }).waitFor();
      await app.close();
      app = undefined;
      const savedPath = join(directory, 'profile/workspace.json');
      await writeFile(savedPath, 'damaged workspace data');
      const broken = await launch(directory, false);
      app = broken.app;
      assert.equal(await readFile(savedPath, 'utf8'), 'damaged workspace data');
      await broken.page
        .getByRole('button', { name: 'Recover previous save', exact: true })
        .click();
      await broken.page
        .getByRole('textbox', { name: 'Video text', exact: true })
        .waitFor();
      assert.equal(
        await broken.page
          .getByRole('textbox', { name: 'Video text', exact: true })
          .inputValue(),
        'Still in memory',
      );
      assert.ok(
        (await readdir(join(directory, 'profile'))).some((name) =>
          name.startsWith('workspace.json.damaged-'),
        ),
      );
    } finally {
      await rm(pending, { recursive: true, force: true });
      if (app) await app.close();
      await rm(directory, { recursive: true });
    }
  },
);
