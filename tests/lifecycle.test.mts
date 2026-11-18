import assert from 'node:assert/strict';
import { startCurrentExport } from './export-helpers.mts';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { _electron } from 'playwright-core';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const ffmpeg = join(root, 'resources/media-tools/darwin-arm64/ffmpeg');
const electron = z.string().parse(createRequire(import.meta.url)('electron'));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}
async function waitFor(
  check: () => boolean | Promise<boolean>,
  message: string,
) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}
function killOwned(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
}

for (const mode of ['repeated-quit', 'force-quit'] as const) {
  test(
    `hidden ${mode} during HDR export reaps owned workers and removes unfinished output`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'video-editor-shutdown-test-'),
      );
      const source = join(directory, 'source.mp4');
      const seed = join(directory, 'seed.mp4');
      const destination = join(directory, 'exports');
      await mkdir(destination);
      await execute(ffmpeg, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=1280x720:r=30:d=1,format=p010le',
        '-c:v',
        'hevc_videotoolbox',
        '-profile:v',
        'main10',
        '-b:v',
        '3M',
        '-g',
        '30',
        '-bsf:v',
        'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9:video_full_range_flag=0',
        '-tag:v',
        'hvc1',
        seed,
      ]);
      await execute(ffmpeg, [
        '-v',
        'error',
        '-stream_loop',
        '29',
        '-i',
        seed,
        '-c',
        'copy',
        '-tag:v',
        'hvc1',
        source,
      ]);
      const application = await _electron.launch({
        executablePath: electron,
        args: [root, `--user-data-dir=${join(directory, 'profile')}`],
        env: { ...process.env, VIDEO_EDITOR_TEST_BACKGROUND: '1' },
      });
      const child = application.process();
      const parentPid = child.pid;
      assert.ok(parentPid);
      let workerPid: number | undefined;
      let guardianPid: number | undefined;
      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-12000);
      });
      try {
        const page = await application.firstWindow();
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
        await page
          .getByText('Bundled resources verified', { exact: true })
          .waitFor();
        await page.getByLabel('Choose a video').setInputFiles(source);
        await page
          .getByRole('button', { name: 'Add text', exact: true })
          .click();
        const input = page.getByRole('textbox', {
          name: 'Video text',
          exact: true,
        });
        await input.fill('Shutdown regression');
        await input.press('Meta+Enter');
        assert.ok(
          await application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every(
              (window) => !window.isVisible() && !window.isFocused(),
            ),
          ),
        );
        await startCurrentExport(page);
        await waitFor(async () => {
          const { stdout } = await execute('/bin/ps', [
            '-axo',
            'pid=,ppid=,args=',
          ]);
          const rows = stdout.split('\n').flatMap((line) => {
            const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
            return match
              ? [
                  {
                    pid: Number(match[1]),
                    parent: Number(match[2]),
                    args: match[3] ?? '',
                  },
                ]
              : [];
          });
          const guardian = rows.find(
            (row) =>
              row.parent === parentPid && row.args.includes('/media-guardian'),
          );
          const worker = rows.find(
            (row) =>
              row.parent === guardian?.pid &&
              row.args.startsWith(ffmpeg) &&
              row.args.includes('-filter_complex'),
          );
          if (!worker || !guardian) return false;
          workerPid = worker.pid;
          guardianPid = guardian.pid;
          return true;
        }, `No owned export encoder started: ${stderr}`);
        assert.ok(workerPid && guardianPid);
        if (mode === 'repeated-quit') {
          killOwned(workerPid, 'SIGSTOP');
          await application.evaluate(({ app }) => {
            setTimeout(() => app.quit(), 25);
            setTimeout(() => app.quit(), 175);
          });
        } else child.kill('SIGKILL');
        await waitFor(
          () => child.exitCode !== null || child.signalCode !== null,
          `Application did not quit: ${stderr}`,
        );
        const encoder = workerPid;
        const supervisor = guardianPid;
        await waitFor(
          () => !alive(encoder) && !alive(supervisor),
          `An owned encoder/supervisor survived ${mode}.`,
        );
        assert.deepEqual(
          await readdir(destination),
          [],
          'No partial or published output may remain after interrupted export.',
        );
        if (mode === 'force-quit') {
          const restored = await _electron.launch({
            executablePath: electron,
            args: [root, `--user-data-dir=${join(directory, 'profile')}`],
            env: { ...process.env, VIDEO_EDITOR_TEST_BACKGROUND: '1' },
          });
          try {
            const page = await restored.firstWindow();
            await page
              .getByRole('dialog', { name: 'Export interrupted', exact: true })
              .waitFor();
            await page
              .getByText('Previous export interrupted.', { exact: false })
              .waitFor();
            assert.equal(
              await page.locator('[data-export-status="interrupted"]').count(),
              1,
            );
            assert.deepEqual(await readdir(destination), []);
            await page
              .getByRole('button', { name: 'Done', exact: true })
              .click();
            await page
              .getByRole('alert')
              .filter({ hasText: 'Previous export interrupted.' })
              .waitFor();
            assert.equal(
              await page
                .getByRole('textbox', { name: 'Video text', exact: true })
                .inputValue(),
              'Shutdown regression',
            );
          } finally {
            await restored.close();
          }
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
          try {
            await application.close();
          } finally {
            clearTimeout(timer);
          }
        }
        if (workerPid && alive(workerPid)) {
          killOwned(workerPid, 'SIGCONT');
          killOwned(workerPid, 'SIGKILL');
        }
        if (guardianPid && alive(guardianPid))
          killOwned(guardianPid, 'SIGTERM');
        const supervisor = guardianPid;
        if (supervisor)
          await waitFor(
            () => !alive(supervisor),
            'Test supervisor did not finish cleanup.',
          );
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
