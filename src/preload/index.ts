import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { z } from 'zod';
import {
  QUEUE_CHANNEL,
  QueueCommandSchema,
  QueueResultSchema,
} from '../shared/export-queue.ts';
import {
  WORKSPACE_CHANNELS,
  WorkspaceSchema,
  WorkspaceResultSchema,
} from '../shared/workspace.ts';
import {
  HISTORY_CHANNELS,
  HistoryCommandSchema,
  HistoryMenuStateSchema,
} from '../shared/history.ts';
import {
  PREVIEW_CHANNELS,
  PreviewRequestSchema,
  PreviewResultSchema,
} from '../shared/preview.ts';
import {
  EDITOR_CHANNELS,
  ImportResultSchema,
  ExportRequestSchema,
  ExportResultSchema,
  ProgressResultSchema,
  ActionResultSchema,
} from '../shared/editor.ts';
import {
  BOOTSTRAP_CHANNEL,
  BootstrapResultSchema,
  type DesktopApi,
} from '../shared/contracts.ts';

const desktop: DesktopApi = {
  exportQueue: async (command) =>
    QueueResultSchema.parse(
      await ipcRenderer.invoke(
        QUEUE_CHANNEL,
        QueueCommandSchema.parse(command),
      ),
    ),
  loadWorkspace: async () =>
    WorkspaceResultSchema.parse(
      await ipcRenderer.invoke(WORKSPACE_CHANNELS.load),
    ),
  saveWorkspace: async (workspace) =>
    ActionResultSchema.parse(
      await ipcRenderer.invoke(
        WORKSPACE_CHANNELS.save,
        WorkspaceSchema.parse(workspace),
      ),
    ),
  removeVideo: async (id) =>
    ActionResultSchema.parse(
      await ipcRenderer.invoke(WORKSPACE_CHANNELS.remove, z.uuid().parse(id)),
    ),
  clearWorkspace: async () =>
    ActionResultSchema.parse(
      await ipcRenderer.invoke(WORKSPACE_CHANNELS.clear),
    ),
  relinkVideo: async (id, file) =>
    ImportResultSchema.parse(
      await ipcRenderer.invoke(
        WORKSPACE_CHANNELS.relink,
        z.uuid().parse(id),
        webUtils.getPathForFile(file),
      ),
    ),
  recoverWorkspace: async () =>
    WorkspaceResultSchema.parse(
      await ipcRenderer.invoke(WORKSPACE_CHANNELS.recover),
    ),
  resetWorkspace: async () =>
    WorkspaceResultSchema.parse(
      await ipcRenderer.invoke(WORKSPACE_CHANNELS.reset),
    ),
  onWorkspaceFlush: (callback, onCancelled) => {
    let pending: string | null = null;
    const receive = (_event: Electron.IpcRendererEvent, token: unknown) => {
      const id = z.uuid().parse(token);
      pending = id;
      void callback().then(
        () => ipcRenderer.send(WORKSPACE_CHANNELS.flushed, id, true),
        (error: unknown) => {
          console.error('Workspace close flush failed.', error);
          ipcRenderer.send(WORKSPACE_CHANNELS.flushed, id, false);
        },
      );
    };
    const acknowledge = (
      _event: Electron.IpcRendererEvent,
      token: unknown,
      saved: unknown,
    ) => {
      const id = z.uuid().parse(token);
      const completed = z.boolean().parse(saved);
      if (id !== pending) return;
      pending = null;
      if (!completed) onCancelled();
    };
    ipcRenderer.on(WORKSPACE_CHANNELS.flush, receive);
    ipcRenderer.on(WORKSPACE_CHANNELS.flushed, acknowledge);
    return () => {
      ipcRenderer.removeListener(WORKSPACE_CHANNELS.flush, receive);
      ipcRenderer.removeListener(WORKSPACE_CHANNELS.flushed, acknowledge);
    };
  },
  getBootstrap: async () => {
    const result: unknown = await ipcRenderer.invoke(BOOTSTRAP_CHANNEL);
    return BootstrapResultSchema.parse(result);
  },
  importVideo: async (file) =>
    ImportResultSchema.parse(
      await ipcRenderer.invoke(
        EDITOR_CHANNELS.import,
        webUtils.getPathForFile(file),
      ),
    ),
  exportVideo: async (request) =>
    ExportResultSchema.parse(
      await ipcRenderer.invoke(
        EDITOR_CHANNELS.export,
        ExportRequestSchema.parse(request),
      ),
    ),
  getExportProgress: async () =>
    ProgressResultSchema.parse(
      await ipcRenderer.invoke(EDITOR_CHANNELS.progress),
    ),
  cancelExport: async () =>
    ActionResultSchema.parse(await ipcRenderer.invoke(EDITOR_CHANNELS.cancel)),
  revealExport: async (id) =>
    ActionResultSchema.parse(
      await ipcRenderer.invoke(EDITOR_CHANNELS.reveal, id),
    ),
  startPreview: async (request) =>
    PreviewResultSchema.parse(
      await ipcRenderer.invoke(
        PREVIEW_CHANNELS.start,
        PreviewRequestSchema.parse(request),
      ),
    ),
  stopPreview: async (id) =>
    ActionResultSchema.parse(
      await ipcRenderer.invoke(PREVIEW_CHANNELS.stop, z.uuid().parse(id)),
    ),
  setHistoryMenuState: async (state) =>
    ActionResultSchema.parse(
      await ipcRenderer.invoke(
        HISTORY_CHANNELS.state,
        HistoryMenuStateSchema.parse(state),
      ),
    ),
  onHistoryCommand: (callback) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(HistoryCommandSchema.parse(value));
    ipcRenderer.on(HISTORY_CHANNELS.command, receive);
    return () => {
      ipcRenderer.removeListener(HISTORY_CHANNELS.command, receive);
    };
  },
};

contextBridge.exposeInMainWorld('desktop', desktop);
