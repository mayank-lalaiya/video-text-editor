import { spawn, type ChildProcess } from 'node:child_process';

export class MediaWorker {
  private readonly children = new Set<ChildProcess>();
  private readonly guardian:
    | { file: string; cleanupDirectories(): string[] }
    | undefined;

  constructor(guardian?: { file: string; cleanupDirectories(): string[] }) {
    this.guardian = guardian;
  }

  private launch(file: string, args: string[], signal: AbortSignal) {
    if (signal.aborted) throw new Error('Operation cancelled.');
    const guardian = this.guardian;
    const child = spawn(
      guardian?.file ?? file,
      guardian
        ? [
            ...guardian
              .cleanupDirectories()
              .flatMap((path) => ['--cleanup-dir', path]),
            '--',
            file,
            ...args,
          ]
        : args,
      {
        stdio: [
          'ignore',
          'pipe',
          'pipe',
          ...(guardian ? ['pipe' as const] : []),
        ],
        shell: false,
        // A Windows guardian must outlive libuv's kill-on-parent-exit Job Object.
        detached: !!guardian,
        windowsHide: true,
      },
    );
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      child.kill('SIGKILL');
      throw new Error('The media worker has no output pipes.');
    }
    this.children.add(child);
    let failure: Error | undefined;
    let stop: () => void = () => {};
    const done = new Promise<void>((resolve, reject) => {
      let errors = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      stop = () => {
        if (timer) return;
        if (guardian && process.platform === 'win32') {
          const lifeline = child.stdio[3];
          if (!lifeline || !('write' in lifeline))
            throw new Error('The Windows worker has no cancellation pipe.');
          lifeline.write(
            Buffer.from([1]),
            (error: Error | null | undefined) => {
              if (error) {
                console.error(
                  'Windows worker cancellation pipe failed.',
                  error,
                );
                child.kill('SIGKILL');
              }
            },
          );
        } else child.kill('SIGTERM');
        stdout.destroy();
        timer = setTimeout(
          () => {
            if (!guardian || process.platform === 'win32') {
              child.kill('SIGKILL');
              return;
            }
            if (child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch (error) {
                if (
                  !(
                    error instanceof Error &&
                    'code' in error &&
                    error.code === 'ESRCH'
                  )
                )
                  console.error(
                    'Media process group could not be killed.',
                    error,
                  );
              }
            }
          },
          guardian ? 4000 : 3000,
        );
      };
      signal.addEventListener('abort', stop, { once: true });
      stderr.on('data', (data: Buffer) => {
        errors = (errors + data.toString()).slice(-16000);
      });
      child.once('error', (error) => {
        failure = error;
      });
      child.once('close', (code) => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        this.children.delete(child);
        if (failure) reject(failure);
        else if (signal.aborted) reject(new Error('Operation cancelled.'));
        else if (code !== 0)
          reject(
            new Error(
              errors.trim() || `Media worker exited with code ${code}.`,
            ),
          );
        else resolve();
      });
    });
    return {
      stdout,
      done,
      fail: (error: Error) => {
        failure = error;
        stop();
      },
    };
  }

  async run(
    file: string,
    args: string[],
    signal: AbortSignal,
    progress?: (microseconds: number) => void,
  ): Promise<string> {
    const job = this.launch(file, args, signal);
    let output = '';
    let pending = '';
    job.stdout.on('data', (data: Buffer) => {
      if (progress) {
        pending += data.toString();
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (match?.[1]) progress(Number(match[1]));
        }
      } else {
        output += data.toString();
        if (output.length > 8 * 1024 * 1024)
          job.fail(
            new Error('Media metadata exceeded the safe response budget.'),
          );
      }
    });
    await job.done;
    return output;
  }

  stream(file: string, args: string[], controller: AbortController) {
    const job = this.launch(file, args, controller.signal);
    const iterator = job.stdout[Symbol.asyncIterator]();
    const body = new ReadableStream<Uint8Array>({
      start: (sink) => {
        void job.done.catch((error: unknown) => sink.error(error));
      },
      pull: async (sink) => {
        const chunk = await iterator.next();
        if (chunk.done) {
          await job.done;
          sink.close();
        } else sink.enqueue(new Uint8Array(chunk.value));
      },
      cancel: async () => {
        controller.abort();
        try {
          await job.done;
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
      },
    });
    return { body, done: job.done };
  }
}
