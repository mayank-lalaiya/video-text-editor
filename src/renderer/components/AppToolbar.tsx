import { useRef, useState } from 'react';
import type { ExportScope } from '../../shared/export-queue.ts';

export function AppToolbar({
  ready,
  busy,
  canExport,
  onImport,
  onExport,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveStatus,
  importing,
  undoGroup,
  redoGroup,
  checkedCount,
  totalCount,
}: {
  ready: boolean;
  busy: boolean;
  canExport: boolean;
  onImport(files: File[]): void;
  onExport(scope: ExportScope): void;
  checkedCount: number;
  totalCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  saveStatus: string;
  importing: boolean;
  undoGroup: boolean;
  redoGroup: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  return (
    <header className="app-toolbar" aria-label="Editor toolbar">
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept=".mp4,.mov,video/mp4,video/quicktime"
        aria-label="Choose a video"
        disabled={!ready || busy || importing}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) onImport(files);
          event.target.value = '';
        }}
      />
      <div className="toolbar-group">
        <button
          className="button primary"
          disabled={!ready || busy || importing}
          onClick={() => input.current?.click()}
          title="Import MP4 and MOV videos. Existing clips and edits are preserved."
        >
          <span aria-hidden="true">+</span> Import videos
        </button>
        <span className="toolbar-divider" />
        <button
          className="button quiet"
          disabled={!ready || busy || !canUndo}
          onClick={onUndo}
          title={
            undoGroup
              ? 'Undo Apply to all: restore copied videos and previous default (Cmd/Ctrl+Z)'
              : 'Undo text edit (Cmd/Ctrl+Z). Retains up to 100 steps / 16 MiB of snapshots.'
          }
        >
          Undo
        </button>
        <button
          className="button quiet"
          disabled={!ready || busy || !canRedo}
          onClick={onRedo}
          title={
            redoGroup
              ? 'Redo Apply to all: restore copied videos and default (Cmd+Shift+Z / Ctrl+Y)'
              : 'Redo text edit (Cmd+Shift+Z / Ctrl+Y)'
          }
        >
          Redo
        </button>
      </div>
      <span className="milestone-badge" role="status">
        {saveStatus}
      </span>
      <div className="toolbar-group">
        <button
          className="button"
          disabled={!ready || busy || importing || !canExport}
          onClick={() => onExport('current')}
        >
          Export current
        </button>
        <div
          className="export-menu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setMenu(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenu(false);
          }}
        >
          <button
            className="button primary"
            disabled={!ready || busy || importing || !totalCount}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            Export batch
          </button>
          {menu && (
            <div className="export-menu-items">
              <button
                className="button"
                disabled={!checkedCount || busy}
                onClick={() => {
                  setMenu(false);
                  onExport('checked');
                }}
              >
                Export checked ({checkedCount})
              </button>
              <button
                className="button"
                disabled={!totalCount || busy}
                onClick={() => {
                  setMenu(false);
                  onExport('all');
                }}
              >
                Export all ({totalCount})
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
