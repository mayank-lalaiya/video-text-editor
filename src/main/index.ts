import { app, BrowserWindow, dialog, nativeTheme, protocol } from 'electron';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { MediaService } from './media/service.ts';
import { ExportQueueService } from './media/export-queue.ts';
import { WorkspaceService } from './workspace/service.ts';
import { registerDesktopApi } from './bridge.ts';
import { createEditorMenu } from './editor-menu.ts';
import { registerFontProtocol } from './resources/font-protocol.ts';
import {
  backgroundTesting,
  createEditorWindow,
  loadEditorWindow,
} from './window.ts';

if (backgroundTesting && process.platform === 'darwin')
  app.setActivationPolicy('prohibited');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'app-font',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let media: MediaService | undefined;
let workspace: WorkspaceService | undefined;
let queue: ExportQueueService | undefined;
let quitting = false;
let cleanupComplete = false;
let editorMenu: ReturnType<typeof createEditorMenu> | undefined;
let flushWindow: ((window: BrowserWindow) => Promise<boolean>) | undefined;
let quitRequested = false;
app.on('before-quit', () => {
  quitRequested = true;
});

app.on('will-quit', (event) => {
  if (!media || cleanupComplete) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  queue?.cancel();
  void (async () => {
    await queue?.wait();
    await media?.dispose();
  })()
    .then(() => {
      cleanupComplete = true;
      app.quit();
    })
    .catch((error: unknown) => {
      console.error('Media cleanup failed during quit.', error);
      if (!backgroundTesting)
        dialog.showErrorBox(
          'Media cleanup failed',
          error instanceof Error ? error.message : String(error),
        );
      app.exit(1);
    });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => app.quit());
}

function reportStartupFailure(error: unknown): void {
  console.error('The editor could not open.', error);
  if (!backgroundTesting)
    dialog.showErrorBox(
      'Unable to open Video Text Editor',
      error instanceof Error ? error.message : String(error),
    );
  app.quit();
}

async function openWindow(): Promise<void> {
  queue?.setClosing(false);
  mainWindow = createEditorWindow();
  const window = mainWindow;
  let canClose = false;
  let closing = false;
  window.on('close', (event) => {
    if (canClose || !flushWindow) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    queue?.setClosing(true);
    void (async () => {
      if (queue?.isRunning() || media?.isExporting()) {
        const answer = await dialog.showMessageBox(window, {
          type: 'warning',
          message: 'An export is still running.',
          detail:
            'Continue exporting, or stop active and queued jobs before closing. Completed outputs will be kept.',
          buttons: ['Continue Export', 'Cancel and Quit'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response === 0) {
          closing = false;
          quitRequested = false;
          queue?.setClosing(false);
          return null;
        }
        quitRequested = true;
      }
      workspace?.pauseRestore();
      queue?.cancel();
      media?.cancel();
      await queue?.wait();
      return await flushWindow?.(window);
    })()
      .then(async (saved) => {
        if (saved === null) return;
        if (!saved) {
          if (backgroundTesting) {
            closing = false;
            quitRequested = false;
            queue?.setClosing(false);
            console.error(
              'Test window close blocked: workspace was not saved.',
            );
            return;
          }
          const answer = await dialog.showMessageBox(window, {
            type: 'warning',
            message: 'Workspace could not be saved.',
            detail:
              'Keep the window open to retry saving, or close and lose unsaved changes. Source media and completed exports are not deleted.',
            buttons: ['Keep open', 'Close without saving'],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response === 0) {
            quitRequested = false;
            closing = false;
            queue?.setClosing(false);
            return;
          }
        }
        canClose = true;
        if (quitRequested) app.quit();
        else window.close();
      })
      .catch((error: unknown) => {
        closing = false;
        quitRequested = false;
        queue?.setClosing(false);
        console.error('Workspace close failed.', error);
      });
  });
  mainWindow.once('closed', () => {
    mainWindow = null;
    editorMenu?.update({ canUndo: false, canRedo: false, fieldEditing: false });
    media?.cancel();
    workspace?.pauseRestore();
    void media
      ?.stopPreview()
      .catch((error: unknown) =>
        console.error(
          'Preview cleanup failed after closing the window.',
          error,
        ),
      );
  });
  await loadEditorWindow(mainWindow);
}

if (app.requestSingleInstanceLock()) {
  app
    .whenReady()
    .then(async () => {
      nativeTheme.themeSource = 'dark';
      const resources = app.isPackaged
        ? join(process.resourcesPath, 'resources')
        : join(app.getAppPath(), 'resources');
      registerFontProtocol(resources);
      media = new MediaService(
        resources,
        await mkdtemp(join(app.getPath('temp'), 'video-text-editor-')),
      );
      media.registerPosterProtocol();
      editorMenu = createEditorMenu(() => mainWindow);
      workspace = new WorkspaceService(
        join(app.getPath('userData'), 'workspace.json'),
        media,
      );
      queue = new ExportQueueService(
        media,
        join(app.getPath('userData'), 'export-session.json'),
        (request, options) => {
          if (!mainWindow || !media)
            throw new Error('Editor window unavailable.');
          return media.exportVideo(request, mainWindow, options);
        },
      );
      flushWindow = registerDesktopApi(
        () => mainWindow,
        resources,
        media,
        editorMenu.update,
        workspace,
        queue,
      );
      await openWindow();
      const activateWindow = () => {
        if (!mainWindow) void openWindow().catch(reportStartupFailure);
        else if (!backgroundTesting) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      };
      app.on('activate', activateWindow);
      app.on('second-instance', activateWindow);
    })
    .catch(reportStartupFailure);
} else {
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
