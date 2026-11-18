import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';

async function stop(child: ChildProcess, browser: Browser | undefined) {
  let forced = false;
  const timeout = setTimeout(() => {
    forced = true;
    child.kill('SIGKILL');
  }, 7000);
  try {
    if (browser) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page && !page.isClosed()) {
        const result = await page.evaluate(() =>
          window.desktop!.exportQueue({ type: 'cancel' }),
        );
        assert.ok(
          result.ok,
          'The test-owned export must accept cleanup cancellation.',
        );
        await page.waitForFunction(
          async () => {
            const result = await window.desktop!.exportQueue({
              type: 'status',
            });
            return (
              result.ok &&
              !['running', 'stopping'].includes(result.state?.status ?? '')
            );
          },
          undefined,
          { timeout: 5000 },
        );
      }
      await browser.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    } else clearTimeout(timeout);
  }
  assert.equal(forced, false, 'The app must stop without a forced kill.');
}

export async function setNativeFiles(
  page: Page,
  selector: string,
  files: string[],
) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    });
    assert.ok(nodeId, 'The native file input must exist.');
    // CDP remote uploads otherwise create JS File objects with no native path.
    await cdp.send('DOM.setFileInputFiles', { nodeId, files });
  } finally {
    await cdp.detach();
  }
}

export async function withPackagedApp(
  application: string,
  profile: string,
  run: (
    page: Page,
    context: BrowserContext,
    child: ChildProcess,
  ) => Promise<void>,
) {
  const child = spawn(
    join(
      application,
      process.platform === 'win32'
        ? 'Video Text Editor.exe'
        : 'Contents/MacOS/Video Text Editor',
    ),
    [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
    ],
    {
      cwd: dirname(profile),
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => key.toLowerCase() !== 'path',
          ),
        ),
        PATH:
          process.platform === 'win32'
            ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
            : '/usr/bin:/bin',
        VIDEO_EDITOR_TEST_BACKGROUND:
          process.env.VIDEO_EDITOR_TEST_BACKGROUND ?? '1',
      },
      windowsHide: true,
    },
  );
  let browser: Browser | undefined;
  let nativeOutput = '';
  child.stderr?.on('data', (data: Buffer) => {
    nativeOutput = (nativeOutput + data.toString()).slice(-12000);
  });
  const failures: unknown[] = [];
  try {
    const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
      let output = '';
      const timeout = setTimeout(
        () => reject(new Error(`App did not become responsive:\n${output}`)),
        25000,
      );
      const fail = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };
      child.once('error', fail);
      child.once('exit', (code) =>
        fail(new Error(`App exited before startup (${code}):\n${output}`)),
      );
      child.stderr?.on('data', (data: Buffer) => {
        output = (output + data.toString()).slice(-12000);
        const match =
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/\S+)/.exec(
            output,
          );
        if (match?.[1]) {
          clearTimeout(timeout);
          resolveEndpoint(match[1]);
        }
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    assert.ok(context, 'The native app must expose its renderer context.');
    await context.setOffline(true);
    const outbound: string[] = [];
    context.on('request', (request) => {
      if (/^https?:/.test(request.url())) outbound.push(request.url());
    });
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await run(page, context, child);
    assert.deepEqual(
      outbound,
      [],
      'The packaged UI must not request HTTP(S) resources.',
    );
    assert.deepEqual(pageErrors, []);
  } catch (error) {
    failures.push(error);
    console.error('Packaged desktop check failed.', error, nativeOutput);
    try {
      const page = browser?.contexts()[0]?.pages()[0];
      if (page && !page.isClosed())
        console.error(
          (await page.locator('body').innerText({ timeout: 3000 })).slice(
            -8000,
          ),
        );
    } catch (error) {
      failures.push(error);
      console.error('Could not read the failed renderer.', error);
    }
  } finally {
    try {
      await stop(child, browser);
    } catch (error) {
      failures.push(error);
      console.error('Application cleanup failed.', error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Desktop validation failed.');
}
