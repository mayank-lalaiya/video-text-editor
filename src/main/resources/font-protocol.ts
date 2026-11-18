import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FONT_FACES } from '../../shared/fonts.ts';
import { readManifest } from './manifest.ts';

export function registerFontProtocol(directory: string): void {
  protocol.handle('app-font', async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    if (
      request.method !== 'GET' ||
      url.hostname !== 'bundle' ||
      url.search !== '' ||
      !FONT_FACES.some((face) => face.id === id)
    ) {
      return new Response('Unknown font.', { status: 404 });
    }
    try {
      const manifest = await readManifest(directory);
      const entry = manifest.resources.find(
        (item) => item.id === id && item.kind === 'font',
      );
      if (!entry) throw new Error(`The font manifest does not contain ${id}.`);
      const bytes = await readFile(join(directory, entry.relativePath));
      return new Response(bytes, {
        headers: {
          'Content-Type': 'font/ttf',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      console.error(`Could not serve bundled font: ${id}`, error);
      return new Response(
        'Bundled font unavailable. Check resource diagnostics.',
        { status: 503 },
      );
    }
  });
}
