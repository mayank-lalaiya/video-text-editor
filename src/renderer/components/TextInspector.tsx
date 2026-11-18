import { useId, useState, type ReactNode } from 'react';
import type { TextBox, VideoAsset } from '../../shared/editor.ts';
import type { EditKind } from '../../shared/history.ts';
import { ColourPicker } from './ColourPicker.tsx';

function NumberField({
  label,
  value,
  min,
  onChange,
  onError,
  steppers = false,
}: {
  label: string;
  value: number | null;
  min: number | undefined;
  onChange(value: number): void;
  onError(error: string): void;
  steppers?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<{
    base: number | null;
    draft: string;
  } | null>(null);
  const display =
    entry?.base === value
      ? entry.draft
      : value === null
        ? ''
        : String(Math.round(value * 100) / 100);
  const valid = (raw: string) => {
    const next = Number(raw);
    return (
      raw.trim() !== '' &&
      Number.isFinite(next) &&
      (min === undefined || next >= min) &&
      (!steppers || Math.abs(next * 10 - Math.round(next * 10)) < 0.000001)
    );
  };
  const step = (amount: number) => {
    if (value === null) return;
    const next = Math.max(min ?? -Infinity, value + amount);
    setEntry(null);
    setError(null);
    onChange(next);
  };
  return (
    <div className={`number-field ${steppers ? 'has-steppers' : ''}`}>
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        aria-invalid={!!error}
        aria-describedby={error ? id : undefined}
        value={display}
        placeholder="--"
        onChange={(event) => {
          const raw = event.target.value;
          const next = Number(raw);
          const accepted = valid(raw);
          setEntry({ base: accepted ? next : value, draft: raw });
          setError(null);
          if (accepted) onChange(next);
        }}
        onBlur={() => {
          if (entry?.base === value && !valid(entry.draft)) {
            const message = `${label} must be ${min === undefined ? 'a finite number' : `at least ${min}`}${steppers ? ', with at most one decimal place' : ''}.`;
            setError(message);
            onError(message);
          }
          setEntry(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (
            steppers &&
            (event.key === 'ArrowUp' || event.key === 'ArrowDown')
          ) {
            event.preventDefault();
            step(event.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      {steppers && (
        <>
          <button
            type="button"
            className="button"
            aria-label="Decrease font size"
            disabled={value === null || (min !== undefined && value <= min)}
            onClick={() => step(-1)}
          >
            -
          </button>
          <button
            type="button"
            className="button"
            aria-label="Increase font size"
            onClick={() => step(1)}
          >
            +
          </button>
        </>
      )}
      {error && (
        <p className="field-error" id={id}>
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInspector({
  box,
  video,
  busy,
  onChange,
  onDelete,
  onError,
  minimumHeight,
  onBeginEdit,
  onAdd,
  onCommit,
  reuse,
}: {
  box: TextBox | null;
  video: VideoAsset | null;
  busy: boolean;
  onChange(box: TextBox, kind?: EditKind): void;
  onDelete(): void;
  onError(error: string): void;
  minimumHeight: number;
  onBeginEdit(): void;
  onAdd(): void;
  onCommit(): void;
  reuse: ReactNode;
}) {
  const colour = box?.colour ?? '#FFFFFF';
  const edit = (patch: Partial<TextBox>, kind: EditKind = 'discrete') => {
    if (box) onChange({ ...box, ...patch }, kind);
  };
  return (
    <aside
      className="text-inspector"
      aria-labelledby="text-heading"
      onPointerDownCapture={onBeginEdit}
      onFocusCapture={onBeginEdit}
      onBlurCapture={onCommit}
    >
      <div className="panel-heading">
        <h2 id="text-heading">Text</h2>
        <span className="secondary">
          {box ? 'Whole-box style' : 'No text selected'}
        </span>
      </div>
      <div className="inspector-scroll">
        {!box && (
          <div className="empty-text-panel">
            <p className="helper">
              Click the video to start typing, or add a centred text box.
            </p>
            <button
              className="button full-width"
              disabled={!video || busy}
              onClick={onAdd}
            >
              Add text
            </button>
          </div>
        )}
        <fieldset disabled={!box || busy}>
          <legend className="sr-only">Text settings</legend>
          <label className="field-label" htmlFor="font-family">
            Font family
          </label>
          <select
            id="font-family"
            value={box?.font ?? 'sans'}
            onChange={(event) => {
              const font = event.target.value;
              if (font === 'sans' || font === 'serif') edit({ font });
            }}
          >
            <option value="sans" style={{ fontFamily: '"Editor Noto Sans"' }}>
              Noto Sans
            </option>
            <option value="serif" style={{ fontFamily: '"Editor Noto Serif"' }}>
              Noto Serif
            </option>
          </select>
          <label className="field-label">Font size (video px)</label>
          <div className="format-row">
            <div className="font-size-field">
              <NumberField
                label="Font size"
                value={box?.fontSize ?? null}
                min={1}
                steppers
                onChange={(fontSize) => edit({ fontSize }, 'inspector')}
                onError={onError}
              />
            </div>
            <button
              className="button bold"
              aria-label="Bold"
              aria-pressed={box?.bold ?? false}
              onClick={() => edit({ bold: !box?.bold })}
            >
              B
            </button>
            <button
              className="button italic"
              aria-label="Italic"
              aria-pressed={box?.italic ?? false}
              onClick={() => edit({ italic: !box?.italic })}
            >
              I
            </button>
          </div>
          <span className="field-label">Colour</span>
          <ColourPicker
            value={colour}
            onChange={(next, kind) => edit({ colour: next }, kind)}
            onCommit={onCommit}
            onError={onError}
          />
          <span className="field-label" id="alignment-label">
            Alignment
          </span>
          <div
            className="segmented"
            role="group"
            aria-labelledby="alignment-label"
          >
            {(['left', 'center', 'right'] as const).map((align) => (
              <button
                className="button"
                key={align}
                aria-label={`Align ${align === 'center' ? 'centre' : align}`}
                aria-pressed={box?.align === align}
                onClick={() => edit({ align })}
              >
                {align === 'center'
                  ? 'Centre'
                  : align === 'left'
                    ? 'Left'
                    : 'Right'}
              </button>
            ))}
          </div>
          <div className="inspector-section">
            <h3>Position &amp; size</h3>
            <div className="geometry-grid">
              {(
                [
                  { key: 'x', label: 'X' },
                  { key: 'y', label: 'Y' },
                  { key: 'width', label: 'Width' },
                  { key: 'height', label: 'Height' },
                ] as const
              ).map(({ key, label }) => (
                <label key={key}>
                  <span>{label}</span>
                  <NumberField
                    label={label}
                    value={box?.[key] ?? null}
                    min={
                      key === 'height'
                        ? minimumHeight
                        : key === 'width'
                          ? 1
                          : undefined
                    }
                    onChange={(value) => edit({ [key]: value }, 'inspector')}
                    onError={onError}
                  />
                </label>
              ))}
            </div>
            <p className="helper">
              Original video pixels. The minimum box fits one grapheme across
              and all text vertically. Font size never changes on resize.
            </p>
          </div>
        </fieldset>
        {reuse}
        <fieldset disabled={!box || busy}>
          <legend className="sr-only">Text positioning actions</legend>
          <div className="inspector-section">
            <button
              className="button full-width"
              onClick={() => {
                if (box && video)
                  onChange({
                    ...box,
                    x: (video.width - box.width) / 2,
                    y: (video.height - box.height) / 2,
                  });
              }}
            >
              Centre in video
            </button>
          </div>
        </fieldset>
      </div>
      <div className="inspector-footer">
        <button
          className="button danger full-width"
          disabled={!box || busy}
          onClick={onDelete}
        >
          Delete text
        </button>
      </div>
    </aside>
  );
}
