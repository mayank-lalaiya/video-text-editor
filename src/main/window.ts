import { BrowserWindow, dialog, screen, session } from 'electron';
import { join } from 'node:path';

export const backgroundTesting =
  process.env.VIDEO_EDITOR_TEST_BACKGROUND === '1';

export function createEditorWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    title: 'Video Text Editor',
    width: Math.min(1440, area.width),
    height: Math.min(900, area.height),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    focusable: !backgroundTesting,
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: !backgroundTesting,
      disableDialogs: backgroundTesting,
    },
  });
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  window.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'Close without saving?',
      message: 'Unsaved changes may be lost.',
      detail:
        'Keep editing to save pending workspace changes, or close without saving them. Previously saved edits, originals and completed exports are unaffected.',
      buttons: ['Keep editing', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) event.preventDefault();
  });
  window.once('ready-to-show', () => {
    if (!backgroundTesting) window.show();
  });
  return window;
}

export async function loadEditorWindow(window: BrowserWindow): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}
