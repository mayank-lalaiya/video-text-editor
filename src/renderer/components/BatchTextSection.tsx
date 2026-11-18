import type { CopyReport, TextDefault } from '../../shared/text-copy.ts';

export function BatchTextSection({
  disabled,
  canApply,
  textDefault,
  report,
  undoGroup,
  redoGroup,
  onApply,
  onEnabled,
  onUndo,
  onRedo,
}: {
  disabled: boolean;
  canApply: boolean;
  textDefault: TextDefault | null;
  report: CopyReport | null;
  undoGroup: boolean;
  redoGroup: boolean;
  onApply(): void;
  onEnabled(enabled: boolean): void;
  onUndo(): void;
  onRedo(): void;
}) {
  return (
    <section
      className="inspector-section batch-text-section"
      aria-label="Reuse text across videos"
    >
      <h3>Reuse across videos</h3>
      <button
        className="button full-width"
        disabled={disabled || !canApply}
        onClick={onApply}
      >
        Apply to all
      </button>
      <p className="helper">
        Only fills videos without text. Existing text is kept.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={textDefault?.enabled ?? false}
          disabled={disabled || !textDefault}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        Auto-apply to new imports
      </label>
      <p className="helper">
        {textDefault
          ? `Last applied: ${textDefault.sourceName} (${textDefault.width} x ${textDefault.height}). ${textDefault.enabled ? 'New imports inherit this snapshot.' : 'New imports start without text.'} Later edits are not linked.`
          : 'No saved text default. Apply to all saves one, even with no other videos.'}
      </p>
      {report && (
        <div className="batch-copy-report">
          <p role="status">
            {report.undone
              ? 'Apply to all undone. Previous text and default restored.'
              : `${report.filled ? `${report.filled} video(s) filled.` : 'Default updated; 0 videos filled.'} ${report.preserved} existing-text video(s) preserved. Source unchanged: ${report.sourceName}.`}
          </p>
          {!report.undone && report.mixed > 0 && (
            <p className="helper">
              {report.mixed} aspect/pixel-ratio copy/copies: check wrapping
              during playback.
            </p>
          )}
          {!report.undone && report.errors.length > 0 && (
            <ul role="alert">
              {report.errors.map(({ name, error }, index) => (
                <li key={index}>
                  {name}: {error}
                </li>
              ))}
            </ul>
          )}
          {report.undoLimited && (
            <p className="helper">
              Group Undo exceeded the 100-step / 16-MiB history budget. Current
              text is retained; check autosave status above.
            </p>
          )}
        </div>
      )}
      {undoGroup && (
        <button
          className="button full-width"
          disabled={disabled}
          onClick={onUndo}
        >
          Undo Apply to all
        </button>
      )}
      {redoGroup && (
        <button
          className="button full-width"
          disabled={disabled}
          onClick={onRedo}
        >
          Redo Apply to all
        </button>
      )}
    </section>
  );
}
