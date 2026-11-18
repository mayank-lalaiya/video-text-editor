import { contextBridge, ipcRenderer } from 'electron';
import {
  EDITOR_CHANNELS,
  OverlayRequestSchema,
  OverlayReadySchema,
  type OverlayReady,
} from '../shared/editor.ts';

contextBridge.exposeInMainWorld('overlayRenderer', {
  getRequest: async () =>
    OverlayRequestSchema.parse(
      await ipcRenderer.invoke(EDITOR_CHANNELS.overlayRequest),
    ),
  ready: async (result: OverlayReady) => {
    await ipcRenderer.invoke(
      EDITOR_CHANNELS.overlayReady,
      OverlayReadySchema.parse(result),
    );
  },
});
