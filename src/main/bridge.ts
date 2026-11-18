import {
  app,
  dialog,
  shell,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { WORKSPACE_CHANNELS, WorkspaceSchema } from '../shared/workspace.ts';
import type { WorkspaceService } from './workspace/service.ts';
import {
  HISTORY_CHANNELS,
  HistoryMenuStateSchema,
  type HistoryMenuState,
} from '../shared/history.ts';
import { PREVIEW_CHANNELS, PreviewRequestSchema } from '../shared/preview.ts';
import { EDITOR_CHANNELS, ExportRequestSchema } from '../shared/editor.ts';
import type { MediaService } from './media/service.ts';
import {
  BOOTSTRAP_CHANNEL,
  BootstrapResultSchema,
} from '../shared/contracts.ts';
import { inspectResources } from './resources/diagnostics.ts';
import { QUEUE_CHANNEL, QueueCommandSchema } from '../shared/export-queue.ts';
import type { ExportQueueService } from './media/export-queue.ts';

export function registerDesktopApi(
  getWindow: () => BrowserWindow | null,
  resourceDirectory: string,
  media: MediaService,
  updateHistoryMenu: (state: HistoryMenuState) => void,
  workspace: WorkspaceService,
  queue: ExportQueueService,
): (window: BrowserWindow) => Promise<boolean> {
  let resourcesReady = false;
  let bootstrapRequest = 0;
  const authorize = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error(
        'Desktop requests are only allowed from the editor window.',
      );
    }
    return window;
  };
  ipcMain.handle(BOOTSTRAP_CHANNEL, async (event, ...args: unknown[]) => {
    let request = 0;
    try {
      authorize(event);
      if (args.length !== 0)
        throw new Error('This operation takes no arguments.');
      request = ++bootstrapRequest;
      const checks = await inspectResources(resourceDirectory);
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        checks.unshift({
          id: 'platform',
          label: 'Supported platform',
          kind: 'tool',
          status: 'error',
          detail: 'This build supports macOS 15+ on Apple silicon only.',
        });
      }
      if (request === bootstrapRequest)
        resourcesReady = checks.every((check) => check.status === 'ready');
      return BootstrapResultSchema.parse({
        ok: true,
        data: {
          appVersion: app.getVersion(),
          platform: process.platform,
          architecture: process.arch,
          checks,
        },
      });
    } catch (error) {
      if (request !== 0 && request === bootstrapRequest) resourcesReady = false;
      console.error('Desktop bootstrap request failed.', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const handle = (
    channel: string,
    operation: (window: BrowserWindow, args: unknown[]) => Promise<unknown>,
  ) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        const window = authorize(event);
        return await operation(window, args);
      } catch (error) {
        console.error(`Media operation failed (${channel}).`, error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };
  const requireIdleQueue = () => {
    if (queue.isRunning())
      throw new Error('Wait for the export queue to finish or stop.');
  };
  handle(EDITOR_CHANNELS.import, async (_window, args) => {
    requireIdleQueue();
    if (!resourcesReady)
      throw new Error('Repair the bundled-resource errors before importing.');
    const [path] = z.tuple([z.string().min(1)]).parse(args);
    return { ok: true, asset: await workspace.importVideo(path) };
  });
  handle(WORKSPACE_CHANNELS.load, async (_window, args) => {
    z.tuple([]).parse(args);
    if (!resourcesReady)
      throw new Error(
        'Repair bundled resources before restoring the workspace.',
      );
    return { ok: true, ...(await workspace.load()) };
  });
  handle(WORKSPACE_CHANNELS.recover, async (_window, args) => {
    requireIdleQueue();
    z.tuple([]).parse(args);
    if (!resourcesReady)
      throw new Error(
        'Repair bundled resources before restoring the workspace.',
      );
    return { ok: true, ...(await workspace.recover()) };
  });
  handle(WORKSPACE_CHANNELS.reset, async (_window, args) => {
    requireIdleQueue();
    z.tuple([]).parse(args);
    if (!resourcesReady)
      throw new Error('Repair bundled resources before resetting.');
    return { ok: true, ...(await workspace.reset()) };
  });
  handle(WORKSPACE_CHANNELS.save, async (_window, args) => {
    const [document] = z.tuple([WorkspaceSchema]).parse(args);
    await workspace.save(document);
    return { ok: true };
  });
  handle(WORKSPACE_CHANNELS.remove, async (_window, args) => {
    requireIdleQueue();
    const [id] = z.tuple([z.uuid()]).parse(args);
    return { ok: true, warning: await workspace.remove(id) };
  });
  handle(WORKSPACE_CHANNELS.clear, async (_window, args) => {
    requireIdleQueue();
    z.tuple([]).parse(args);
    return { ok: true, warning: await workspace.clear() };
  });
  handle(WORKSPACE_CHANNELS.relink, async (_window, args) => {
    requireIdleQueue();
    if (!resourcesReady)
      throw new Error('Repair bundled resources before relinking.');
    const [id, path] = z.tuple([z.uuid(), z.string().min(1)]).parse(args);
    return { ok: true, asset: await workspace.relink(id, path) };
  });
  handle(EDITOR_CHANNELS.export, async (window, args) => {
    requireIdleQueue();
    if (!resourcesReady)
      throw new Error('Repair the bundled-resource errors before exporting.');
    const [request] = z.tuple([ExportRequestSchema]).parse(args);
    return await media.exportVideo(request, window);
  });
  handle(QUEUE_CHANNEL, async (window, args) => {
    const [command] = z.tuple([QueueCommandSchema]).parse(args);
    await queue.load();
    if (command.type === 'prepare' || command.type === 'start') {
      if (!resourcesReady)
        throw new Error('Repair bundled resources before exporting.');
    }
    switch (command.type) {
      case 'prepare':
        await queue.prepare(command.scope, workspace.snapshot());
        break;
      case 'folder': {
        const state = queue.snapshot();
        if (state?.status !== 'preflight')
          throw new Error('Open export preflight first.');
        const result = await dialog.showOpenDialog(window, {
          title: 'Choose a folder for edited videos',
          ...(state.folder ? { defaultPath: state.folder } : {}),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (
          window.isDestroyed() ||
          getWindow() !== window ||
          queue.snapshot()?.id !== state.id
        )
          throw new Error(
            'The editor window or export preflight changed while choosing a folder. Choose the folder again in the current preflight.',
          );
        if (!result.canceled && result.filePaths[0])
          await queue.setFolder(result.filePaths[0]);
        break;
      }
      case 'start':
        await queue.start(command.id);
        break;
      case 'cancel':
        queue.cancel();
        break;
      case 'show-folder': {
        const folder = queue.snapshot()?.folder;
        if (!folder) throw new Error('No output folder is available.');
        const error = await shell.openPath(folder);
        if (error) throw new Error(error);
        break;
      }
      case 'status':
        break;
      case 'dismiss':
        queue.dismiss();
        break;
    }
    return { ok: true, state: queue.snapshot() };
  });
  handle(EDITOR_CHANNELS.progress, async (_window, args) => {
    z.tuple([]).parse(args);
    return { ok: true, progress: media.getProgress() };
  });
  handle(EDITOR_CHANNELS.cancel, async (_window, args) => {
    z.tuple([]).parse(args);
    queue.cancel();
    media.cancel();
    return { ok: true };
  });
  handle(EDITOR_CHANNELS.reveal, async (_window, args) => {
    const [id] = z.tuple([z.uuid()]).parse(args);
    media.reveal(id);
    return { ok: true };
  });
  handle(PREVIEW_CHANNELS.start, async (_window, args) => {
    requireIdleQueue();
    if (!resourcesReady)
      throw new Error('Repair the bundled-resource errors before playback.');
    const [request] = z.tuple([PreviewRequestSchema]).parse(args);
    return await media.startPreview(request);
  });
  handle(PREVIEW_CHANNELS.stop, async (_window, args) => {
    const [id] = z.tuple([z.uuid()]).parse(args);
    await media.stopPreview(id);
    return { ok: true };
  });
  handle(HISTORY_CHANNELS.state, async (_window, args) => {
    const [state] = z.tuple([HistoryMenuStateSchema]).parse(args);
    updateHistoryMenu(state);
    return { ok: true };
  });
  return (window) =>
    new Promise((resolve) => {
      const token = randomUUID();
      const complete = (value: boolean) => {
        clearTimeout(timer);
        ipcMain.removeListener(WORKSPACE_CHANNELS.flushed, receive);
        if (!window.webContents.isDestroyed())
          window.webContents.send(WORKSPACE_CHANNELS.flushed, token, value);
        resolve(value);
      };
      const receive = (
        event: Electron.IpcMainEvent,
        id: unknown,
        saved: unknown,
      ) => {
        if (
          event.sender === window.webContents &&
          event.senderFrame === window.webContents.mainFrame &&
          id === token
        )
          complete(saved === true);
      };
      const timer = setTimeout(() => complete(false), 15000);
      ipcMain.on(WORKSPACE_CHANNELS.flushed, receive);
      window.webContents.send(WORKSPACE_CHANNELS.flush, token);
    });
}
