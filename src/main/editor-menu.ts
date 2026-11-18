import { Menu, type BrowserWindow } from 'electron';
import {
  HISTORY_CHANNELS,
  type HistoryCommand,
  type HistoryMenuState,
} from '../shared/history.ts';

export function createEditorMenu(getWindow: () => BrowserWindow | null) {
  let state: HistoryMenuState = {
    canUndo: false,
    canRedo: false,
    fieldEditing: false,
  };
  const perform = (command: HistoryCommand) => {
    const window = getWindow();
    if (!window) return;
    // Keep native field undo separate from the video's object history.
    if (state.fieldEditing) {
      if (command === 'undo') window.webContents.undo();
      else window.webContents.redo();
    } else window.webContents.send(HISTORY_CHANNELS.command, command);
  };
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : [
          {
            label: 'File',
            submenu: [{ role: 'quit' as const }],
          },
        ]),
    {
      role: 'editMenu',
      label: 'Edit',
      submenu: [
        {
          id: 'editor-undo',
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          enabled: false,
          click: () => perform('undo'),
        },
        {
          id: 'editor-redo',
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          enabled: false,
          click: () => perform('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        ...(process.platform === 'darwin'
          ? [
              {
                label: 'Speech',
                submenu: [
                  { role: 'startSpeaking' as const },
                  { role: 'stopSpeaking' as const },
                ],
              },
            ]
          : []),
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
  return {
    update(next: HistoryMenuState) {
      state = next;
      const undo = menu.getMenuItemById('editor-undo');
      const redo = menu.getMenuItemById('editor-redo');
      if (!undo || !redo)
        throw new Error('Editor history menu is unavailable.');
      undo.enabled = state.canUndo || state.fieldEditing;
      redo.enabled = state.canRedo || state.fieldEditing;
    },
  };
}
