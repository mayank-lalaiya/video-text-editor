import { useId, useRef, useState, type PointerEvent } from 'react';
import type { EditKind } from '../../shared/history.ts';

interface HSV {
  hue: number;
  saturation: number;
  brightness: number;
}
function toHSV(hex: string): HSV {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const delta = maximum - Math.min(red, green, blue);
  const sector =
    delta === 0
      ? 0
      : maximum === red
        ? ((green - blue) / delta) % 6
        : maximum === green
          ? (blue - red) / delta + 2
          : (red - green) / delta + 4;
  return {
    hue: (sector * 60 + 360) % 360,
    saturation: maximum === 0 ? 0 : (delta / maximum) * 100,
    brightness: maximum * 100,
  };
}
function toHex(hsv: HSV): string {
  return (
    '#' +
    [5, 3, 1]
      .map((offset) => {
        const sector = (offset + hsv.hue / 60) % 6;
        const channel =
          (hsv.brightness / 100) *
          (1 -
            (hsv.saturation / 100) *
              Math.max(0, Math.min(sector, 4 - sector, 1)));
        return Math.round(channel * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
      .toUpperCase()
  );
}

export function ColourPicker({
  value,
  onChange,
  onCommit,
  onError,
}: {
  value: string;
  onChange(colour: string, kind: EditKind): void;
  onCommit(): void;
  onError(error: string): void;
}) {
  const id = useId();
  const swatch = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<{ base: string; draft: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ base: string; hsv: HSV } | null>(null);
  const hsv = draft?.base === value ? draft.hsv : toHSV(value);
  const hex = entry?.base === value ? entry.draft : value;
  const changeHSV = (next: HSV) => {
    const colour = toHex(next);
    setDraft({ base: colour, hsv: next });
    onChange(colour, 'inspector');
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    changeHSV({
      ...hsv,
      saturation: Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
      ),
      brightness: Math.max(
        0,
        Math.min(100, ((rect.bottom - event.clientY) / rect.height) * 100),
      ),
    });
  };
  return (
    <div
      className="colour-picker"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          onCommit();
          setOpen(false);
          swatch.current?.focus();
        }
      }}
    >
      <div className="colour-row">
        <button
          ref={swatch}
          type="button"
          className="button colour-swatch"
          style={{ backgroundColor: value }}
          aria-label="Text colour"
          aria-expanded={open}
          aria-controls={id}
          title={`Text colour ${value}`}
          onClick={() => setOpen(!open)}
        />
        <input
          aria-label="Text colour HEX"
          value={hex}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            const valid = /^#[0-9a-f]{6}$/i.test(raw);
            const next = raw.toUpperCase();
            setEntry({ base: valid ? next : value, draft: raw });
            setError(null);
            if (valid) onChange(next, 'inspector');
          }}
          onBlur={() => {
            if (!/^#[0-9a-f]{6}$/i.test(hex)) {
              const message = 'Use a six-digit colour such as #FFFFFF.';
              setError(message);
              onError(message);
            }
            setEntry(null);
            onCommit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {open && (
        <section
          className="colour-popup"
          id={id}
          aria-label="Text colour picker"
        >
          <div
            className="colour-sv"
            aria-hidden="true"
            style={{ backgroundColor: `hsl(${hsv.hue} 100% 50%)` }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              point(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                point(event);
            }}
            onPointerUp={onCommit}
            onPointerCancel={onCommit}
          >
            <span
              style={{
                left: `${hsv.saturation}%`,
                top: `${100 - hsv.brightness}%`,
              }}
            />
          </div>
          {(
            [
              ['hue', 'Hue', 359],
              ['saturation', 'Saturation', 100],
              ['brightness', 'Brightness', 100],
            ] as const
          ).map(([key, label, max]) => (
            <label className="colour-slider" key={key}>
              <span>{label}</span>
              <input
                type="range"
                min={0}
                max={max}
                step={1}
                value={hsv[key]}
                aria-label={label}
                aria-valuetext={`${Math.round(hsv[key])}${key === 'hue' ? ' degrees' : '%'}`}
                onChange={(event) =>
                  changeHSV({ ...hsv, [key]: Number(event.target.value) })
                }
                onPointerUp={onCommit}
                onKeyUp={onCommit}
                onBlur={onCommit}
              />
            </label>
          ))}
          <div
            className="colour-presets"
            role="group"
            aria-label="Colour presets"
          >
            {[
              '#FFFFFF',
              '#000000',
              '#FF0000',
              '#00FF00',
              '#0000FF',
              '#FFFF00',
              '#FF00FF',
              '#00FFFF',
            ].map((colour) => (
              <button
                key={colour}
                type="button"
                className="button colour-swatch"
                style={{ backgroundColor: colour }}
                aria-label={`Use colour ${colour}`}
                aria-pressed={value === colour}
                onClick={() => onChange(colour, 'discrete')}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
