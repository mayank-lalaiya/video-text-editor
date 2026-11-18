import { useEffect, useRef } from 'react';
import { VideoIcon } from './VideoIcon.tsx';
import type { WorkspaceEntry } from '../../shared/workspace.ts';
import type { ExportJob } from '../../shared/export-queue.ts';

export function VideoSidebar({
  entries,
  activeId,
  disabled,
  importing,
  hasDefault,
  exportJobs,
  onActivate,
  onCheck,
  onRemove,
  onClear,
  onRelink,
}: {
  entries: WorkspaceEntry[];
  activeId: string | null;
  disabled: boolean;
  importing: boolean;
  hasDefault: boolean;
  exportJobs: ExportJob[];
  onActivate(id: string): void;
  onCheck(id: string | null, checked: boolean): void;
  onRemove(id: string): void;
  onClear(): void;
  onRelink(id: string, file: File): void;
}) {
  const selectAll = useRef<HTMLInputElement>(null);
  const count = entries.filter((entry) => entry.checked).length;
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = count > 0 && count < entries.length;
  }, [count, entries.length]);
  return (
    <aside className="video-sidebar" aria-labelledby="videos-heading">
      <div className="panel-heading">
        <h2 id="videos-heading">
          Videos <span className="count-badge">{entries.length}</span>
        </h2>
      </div>
      <div className="selection-row">
        <label>
          <input
            ref={selectAll}
            type="checkbox"
            checked={entries.length > 0 && count === entries.length}
            disabled={disabled || !entries.length}
            onChange={(event) => onCheck(null, event.target.checked)}
          />{' '}
          Select all for export
        </label>
        <span>{count} selected</span>
      </div>
      <div className="video-list">
        {entries.length ? (
          entries.map(({ asset, checked, text, issue }) => {
            const job = exportJobs.find((item) => item.assetId === asset.id);
            const exportStatus =
              job?.status === 'completed'
                ? JSON.stringify(job.textBox) ===
                  JSON.stringify(text?.box ?? null)
                  ? 'Exported'
                  : 'Changed since export'
                : job?.status === 'exporting'
                  ? 'Exporting'
                  : job?.status === 'failed'
                    ? 'Failed'
                    : null;
            return (
              <div
                className="video-card"
                key={asset.id}
                aria-current={asset.id === activeId ? 'true' : undefined}
              >
                <input
                  type="checkbox"
                  aria-label={`Export ${asset.name}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => onCheck(asset.id, event.target.checked)}
                />
                <button
                  className="video-open"
                  aria-label={`Open ${asset.name}`}
                  disabled={disabled}
                  onClick={() => onActivate(asset.id)}
                >
                  {!issue && (
                    <img src={`app-media://poster/${asset.id}`} alt="" />
                  )}
                  <span>
                    <strong>{asset.name}</strong>
                    <span>
                      {asset.width} x {asset.height} /{' '}
                      {asset.duration.toFixed(2)}s
                    </span>
                    <span>
                      {issue
                        ? 'Source unavailable'
                        : `${asset.colour.dynamicRange === 'sdr' ? `${asset.colour.bitDepth === 10 ? '10-bit ' : ''}SDR` : `${asset.colour.dynamicRange.toUpperCase()} HDR`} / ${exportStatus ?? (text?.box.text.trim() ? 'Text ready' : 'No text')}`}
                    </span>
                  </span>
                </button>
                <button
                  className="button quiet row-remove"
                  aria-label={`Remove ${asset.name}`}
                  title="Remove from workspace only. Source media and completed exports remain on disk."
                  disabled={disabled || importing}
                  onClick={() => onRemove(asset.id)}
                >
                  x
                </button>
                <label
                  className="relink-file"
                  title="Locate the matching original video"
                >
                  Locate
                  <input
                    type="file"
                    accept=".mp4,.mov"
                    aria-label={`Locate ${asset.name}`}
                    disabled={disabled || importing}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onRelink(asset.id, file);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
            );
          })
        ) : (
          <div className="sidebar-empty">
            <VideoIcon size={40} />
            <h3>No videos yet</h3>
            <p>
              Import or drop MP4 and MOV files. One video is shown at a time.
            </p>
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <span>MP4 and MOV</span>
        <button
          className="button quiet"
          disabled={disabled || importing || (!entries.length && !hasDefault)}
          onClick={onClear}
        >
          Clear workspace
        </button>
      </div>
    </aside>
  );
}
