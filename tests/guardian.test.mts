import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

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

test(
  'guardian reaps a SIGTERM-resistant worker after its parent dies and removes only owned temporary media',
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'video-editor-guardian-test-'),
    );
    const temporary = join(directory, '.video-text-editor-abcdef');
    const original = join(directory, 'original.mp4');
    await mkdir(temporary);
    await writeFile(join(temporary, 'text.png'), 'overlay');
    await writeFile(join(temporary, 'output.mp4'), 'unfinished');
    await writeFile(original, 'untouched original');
    const workerModule = pathToFileURL(
      resolve('src/main/media/worker.ts'),
    ).href;
    const guardian = resolve(
      'resources/media-tools/darwin-arm64/media-guardian',
    );
    const script = join(directory, 'parent.mjs');
    await writeFile(
      script,
      `
import { MediaWorker } from ${JSON.stringify(workerModule)};
const worker = new MediaWorker({
  file: ${JSON.stringify(guardian)},
  cleanupDirectories: () => [${JSON.stringify(temporary)}],
});
const job = worker.stream(process.execPath, ['-e',
  'process.on("SIGTERM",()=>{});process.stdout.write(String(process.pid));setInterval(()=>{},1000);'
], new AbortController());
job.done.catch(error => { console.error(error); process.exitCode = 1; });
const reader = job.body.getReader();
const first = await reader.read();
process.stdout.write(Buffer.from(first.value).toString() + '\\n');
`,
    );
    const parent = spawn(process.execPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let workerPid: number | undefined;
    let stderr = '';
    parent.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    try {
      workerPid = await new Promise<number>((resolvePid, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Worker did not start: ${stderr}`)),
          5000,
        );
        parent.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        parent.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`Parent exited early: ${stderr}`));
        });
        let output = '';
        parent.stdout.on('data', (data: Buffer) => {
          output += data.toString();
          if (!output.includes('\n')) return;
          const pid = Number(output.trim());
          clearTimeout(timer);
          if (!Number.isSafeInteger(pid) || pid <= 0)
            reject(new Error(`Invalid worker PID: ${output}`));
          else resolvePid(pid);
        });
      });
      parent.kill('SIGKILL');
      for (let attempt = 0; attempt < 250 && alive(workerPid); attempt++)
        await delay(20);
      assert.equal(
        alive(workerPid),
        false,
        'A dead application must not leave its encoder running.',
      );
      let removed = false;
      for (let attempt = 0; attempt < 250 && !removed; attempt++) {
        try {
          await access(temporary);
          await delay(20);
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            removed = true;
          else throw error;
        }
      }
      assert.equal(removed, true, `Owned media was not removed: ${stderr}`);
      assert.equal(await readFile(original, 'utf8'), 'untouched original');
    } finally {
      if (parent.exitCode === null && parent.signalCode === null)
        parent.kill('SIGKILL');
      if (workerPid && alive(workerPid)) process.kill(workerPid, 'SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  },
);
