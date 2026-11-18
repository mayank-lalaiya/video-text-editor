import { link } from 'node:fs/promises';
import { join, parse } from 'node:path';

export function outputFilename(sourceName: string, suffix: number): string {
  const name = `${parse(sourceName).name}_edited${suffix === 1 ? '' : `_${suffix}`}.mp4`;
  if (process.platform === 'win32' && name.length > 255) {
    const error: NodeJS.ErrnoException = new Error(
      'Output filename is too long. Rename the original and locate it again, preserving its saved text.',
    );
    error.code = 'ENAMETOOLONG';
    throw error;
  }
  return name;
}

export async function publishOutput(
  partial: string,
  destination: string,
  sourceName: string,
  signal: AbortSignal,
  startSuffix = 1,
): Promise<string> {
  for (let suffix = startSuffix; ; suffix += 1) {
    if (signal.aborted) throw new Error('Export cancelled.');
    const output = join(destination, outputFilename(sourceName, suffix));
    try {
      await link(partial, output);
      return output;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        continue;
      throw new Error(
        'Could not publish the output without overwriting. Choose a writable local folder supporting hard links.',
        { cause: error },
      );
    }
  }
}
