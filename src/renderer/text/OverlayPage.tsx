import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TextLayer, measureTextBox } from './TextLayer.tsx';
import { loadBundledFonts } from './fonts.ts';
import type { OverlayReady, OverlayRequest } from '../../shared/editor.ts';

declare global {
  interface Window {
    convertOverlayPngToSrgb?: (base64: string) => Promise<string>;
    readonly overlayRenderer?: {
      getRequest(): Promise<OverlayRequest>;
      ready(result: OverlayReady): Promise<void>;
    };
  }
}

export async function renderOverlayPage(): Promise<void> {
  const bridge = window.overlayRenderer;
  if (!bridge) throw new Error('The isolated overlay bridge is unavailable.');
  try {
    document.documentElement.className = 'overlay-document';
    const request = await bridge.getRequest();
    await loadBundledFonts();
    const root = document.getElementById('root');
    if (!root) throw new Error('Overlay root is missing.');
    flushSync(() =>
      createRoot(root).render(<TextLayer box={request.textBox} />),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    window.convertOverlayPngToSrgb = async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!context) throw new Error('The sRGB overlay canvas is unavailable.');
      context.drawImage(image, 0, 0);
      const prefix = 'data:image/png;base64,';
      const encoded = canvas.toDataURL('image/png');
      if (!encoded.startsWith(prefix))
        throw new Error('The sRGB overlay could not be encoded.');
      return encoded.slice(prefix.length);
    };
    await bridge.ready({
      ok: true,
      minimumHeight: measureTextBox(request.textBox).height,
    });
  } catch (error) {
    console.error('Text overlay could not render.', error);
    await bridge.ready({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
