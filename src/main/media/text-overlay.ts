import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { backgroundTesting } from '../window.ts';
import {
  EDITOR_CHANNELS,
  OverlayReadySchema,
  type OverlayRequest,
} from '../../shared/editor.ts';

export async function rasterizeText(
  request: OverlayRequest,
  signal: AbortSignal,
): Promise<Buffer> {
  if (signal.aborted) throw new Error('Export cancelled.');
  const window = new BrowserWindow({
    show: false,
    focusable: !backgroundTesting,
    width: request.width,
    height: request.height,
    transparent: true,
    frame: process.platform !== 'win32',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'overlay-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // Windows needs a composited surface even though this window is never shown.
      offscreen: process.platform === 'win32',
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const authenticate = (senderId: number) => {
    if (senderId !== window.webContents.id)
      throw new Error('Unrecognized overlay renderer.');
  };
  let interrupt!: (reason: Error) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    interrupt = reject;
  });
  const abort = () => interrupt(new Error('Export cancelled.'));
  const closed = () =>
    interrupt(new Error('Text renderer closed before completing the export.'));
  window.once('closed', closed);
  const timeout = setTimeout(
    () =>
      interrupt(new Error('Text rendering did not finish within 20 seconds.')),
    20000,
  );
  const ready = new Promise<void>((resolve, reject) => {
    ipcMain.handle(
      EDITOR_CHANNELS.overlayRequest,
      (event, ...args: unknown[]) => {
        authenticate(event.sender.id);
        if (args.length) throw new Error('Overlay request takes no arguments.');
        return request;
      },
    );
    ipcMain.handle(EDITOR_CHANNELS.overlayReady, (event, result: unknown) => {
      authenticate(event.sender.id);
      const report = OverlayReadySchema.parse(result);
      if (!report.ok) reject(new Error(report.error));
      else if (report.minimumHeight > request.textBox.height + 1)
        reject(
          new Error(
            'Text no longer fits its box. Reselect the text and retry.',
          ),
        );
      else resolve();
    });
  });
  signal.addEventListener('abort', abort, { once: true });
  const render = async () => {
    const loading = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?view=overlay`)
      : window.loadFile(
          join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
          { query: { view: 'overlay' } },
        );
    const graphics = loading.then(async () => {
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand(
        'Emulation.setDeviceMetricsOverride',
        {
          width: request.width,
          height: request.height,
          deviceScaleFactor: 1,
          mobile: false,
        },
      );
      await window.webContents.debugger.sendCommand(
        'Emulation.setDefaultBackgroundColorOverride',
        {
          color: { r: 0, g: 0, b: 0, a: 0 },
        },
      );
    });
    await Promise.all([graphics, ready]);
    if (signal.aborted) throw new Error('Export cancelled.');
    const capture: { data?: unknown } =
      await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: request.width,
          height: request.height,
          scale: 1,
        },
      });
    if (typeof capture.data !== 'string')
      throw new Error('Text renderer returned no PNG.');
    // Screenshots may contain Display P3 pixels; FFmpeg does not apply PNG ICC profiles.
    const srgb: unknown = await window.webContents.executeJavaScript(
      `window.convertOverlayPngToSrgb(${JSON.stringify(capture.data)})`,
    );
    if (typeof srgb !== 'string')
      throw new Error('Text renderer returned no sRGB PNG.');
    const png = Buffer.from(srgb, 'base64');
    if (
      png.length < 24 ||
      png.readUInt32BE(16) !== request.width ||
      png.readUInt32BE(20) !== request.height
    ) {
      throw new Error(
        'Text overlay resolution does not match the oriented source.',
      );
    }
    return png;
  };
  try {
    if (signal.aborted) abort();
    return await Promise.race([render(), interruption]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    window.removeListener('closed', closed);
    ipcMain.removeHandler(EDITOR_CHANNELS.overlayRequest);
    ipcMain.removeHandler(EDITOR_CHANNELS.overlayReady);
    if (!window.isDestroyed()) window.destroy();
  }
}
