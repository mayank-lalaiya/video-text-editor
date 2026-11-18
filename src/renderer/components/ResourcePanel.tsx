import type { DesktopStatus } from '../useDesktopStatus.ts';

export function ResourcePanel({
  status,
  onRefresh,
}: {
  status: DesktopStatus;
  onRefresh: () => void;
}) {
  const title =
    status.phase === 'ready'
      ? 'Bundled resources verified'
      : status.phase === 'error'
        ? 'Bundled resources need attention'
        : 'Checking bundled resources...';
  return (
    <section
      className={`resource-panel ${status.phase}`}
      aria-label="Bundled resources"
    >
      <div className="resource-heading">
        <div>
          <p className="resource-title" role="status">
            <span className="status-dot" />
            {title}
          </p>
          <p className="helper">
            Local font files and native tools. No cloud services.
          </p>
        </div>
        <button
          className="button quiet"
          onClick={onRefresh}
          disabled={status.phase === 'checking'}
        >
          Check again
        </button>
      </div>
      {status.errors.map((error) => (
        <p role="alert" className="error-message" key={error}>
          {error}
        </p>
      ))}
      <details open={status.phase === 'error'}>
        <summary>Resource details</summary>
        <div className="resource-details">
          {status.data?.checks.map((check) => (
            <div className={`resource-item ${check.status}`} key={check.id}>
              <div>
                <strong>{check.label}</strong>
                <span>{check.status === 'ready' ? 'Verified' : 'Error'}</span>
              </div>
              <p>{check.detail}</p>
            </div>
          ))}
          {status.phase === 'ready' && (
            <div className="font-samples" aria-label="Bundled font samples">
              <span className="sans-sample">
                Noto Sans <b>Bold</b> <i>Italic</i>
              </span>
              <span className="serif-sample">
                Noto Serif <b>Bold</b> <i>Italic</i>
              </span>
              <span
                className="emoji-sample"
                aria-label="Bundled colour emoji sample"
              >
                {'\u{1F308}'}
              </span>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
