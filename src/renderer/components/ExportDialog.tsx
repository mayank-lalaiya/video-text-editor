import { useEffect, useRef } from 'react';
import {
  queueRunning,
  type ExportQueue,
  type QueueCommand,
} from '../../shared/export-queue.ts';

const scopeNames = {
  current: 'Current video',
  checked: 'Checked videos',
  all: 'All videos',
  retry: 'Failed videos (current edits)',
};

export function ExportDialog({
  state,
  open,
  pending,
  error,
  onAction,
  onClose,
  onRetry,
}: {
  state: ExportQueue | null;
  open: boolean;
  pending: boolean;
  error: string | null;
  onAction(command: QueueCommand): void;
  onClose(): void;
  onRetry(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = queueRunning(state);
  const preflight = state?.status === 'preflight';
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  if (!state) return null;
  const count = (status: string) =>
    state.jobs.filter((job) => job.status === status).length;
  const eligible = state.jobs.filter(
    (job) => !['skipped', 'blocked'].includes(job.status),
  );
  const finished = eligible.filter(
    (job) => !['ready', 'queued', 'exporting'].includes(job.status),
  ).length;
  const fraction = eligible.length
    ? Math.min(
        1,
        (finished + (count('exporting') ? state.fraction : 0)) /
          eligible.length,
      )
    : 0;
  const current = state.jobs.find((job) => job.status === 'exporting');
  const dismiss = () => (preflight ? onAction({ type: 'dismiss' }) : onClose());
  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      aria-labelledby="export-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!running && !pending) dismiss();
      }}
    >
      <h2 id="export-heading">
        {preflight
          ? 'Export preflight'
          : running
            ? state.status === 'stopping'
              ? 'Stopping export...'
              : 'Exporting videos'
            : state.status === 'interrupted'
              ? 'Export interrupted'
              : 'Export results'}
      </h2>
      <p>
        {scopeNames[state.scope]} / {state.jobs.length} video(s)
      </p>
      {state.notice && (
        <p className="notice warning" role="alert">
          {state.notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {preflight ? (
        <>
          <p>
            {count('ready')} eligible / {count('skipped')} skipped /{' '}
            {count('blocked')} unavailable
          </p>
          <p>
            Original size, timing and supported audio. High-quality lossy MP4,
            not lossless.
          </p>
          <div className="export-folder">
            <span>Output folder: {state.folder ?? 'Not selected'}</span>
            <button
              className="button"
              disabled={pending}
              onClick={() => onAction({ type: 'folder' })}
            >
              Choose folder
            </button>
          </div>
          {state.folderError && (
            <p className="notice error" role="alert">
              {state.folderError}
            </p>
          )}
          {state.freeBytes !== null && (
            <p>
              {(state.freeBytes / 1024 ** 3).toFixed(2)} GiB available. Final
              output size varies; keep sufficient free space.
            </p>
          )}
          <p>
            Existing files are never overwritten. Planned names may gain a
            suffix if another file appears.
          </p>
        </>
      ) : running ? (
        <div className="export-progress" role="status">
          <p>
            {current?.name ?? 'Preparing queue'} / {state.phase} /{' '}
            {Math.round(state.fraction * 100)}%
          </p>
          <label>
            Current video{' '}
            <progress
              aria-label="Current video progress"
              max={1}
              value={state.fraction}
            />
          </label>
          <label>
            Overall ({finished}/{eligible.length}){' '}
            <progress
              aria-label="Overall export progress"
              max={1}
              value={fraction}
            />
          </label>
          {state.status === 'stopping' && (
            <p>
              Waiting for writers and temporary-file cleanup. Completed outputs
              will be kept.
            </p>
          )}
        </div>
      ) : (
        <p>
          {count('completed')} completed / {count('failed')} failed /{' '}
          {count('cancelled')} cancelled / {count('skipped')} skipped /{' '}
          {count('blocked')} unavailable / {count('interrupted')} interrupted
        </p>
      )}
      {!state.jobs.length && (
        <p>
          No videos in this scope. Check videos in the sidebar, or choose
          another scope.
        </p>
      )}
      <ol className="export-job-list">
        {state.jobs.map((job) => (
          <li key={job.assetId} data-export-status={job.status}>
            <strong>{job.name}</strong>{' '}
            <span className="export-job-status">{job.status}</span>
            <span>{job.format}</span>
            <span>{job.path ?? job.filename}</span>
            {job.temporaryPath && (!running || job.status === 'failed') && (
              <span className="export-warning">
                Tracked temporary folder (may remain after interruption or
                cleanup failure): {job.temporaryPath}
              </span>
            )}
            {job.error && (
              <span
                role={job.status === 'blocked' ? 'alert' : undefined}
                className={
                  job.status === 'completed' ? 'export-warning' : 'export-error'
                }
              >
                {job.error}
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="export-actions">
        {preflight ? (
          <>
            <button className="button" disabled={pending} onClick={dismiss}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                pending ||
                !count('ready') ||
                !state.folder ||
                !!state.folderError
              }
              onClick={() => onAction({ type: 'start', id: state.id })}
            >
              Start export
            </button>
          </>
        ) : running ? (
          <button
            className="button"
            disabled={pending || state.status === 'stopping'}
            onClick={() => onAction({ type: 'cancel' })}
          >
            Cancel export
          </button>
        ) : (
          <>
            {count('failed') > 0 && (
              <button className="button" disabled={pending} onClick={onRetry}>
                Retry failed
              </button>
            )}
            <button
              className="button"
              disabled={pending || !state.folder}
              onClick={() => onAction({ type: 'show-folder' })}
            >
              Show output folder
            </button>
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
