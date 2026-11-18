import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';
import {
  HANDLES,
  resizeTextBox,
  type ResizeHandle,
  type TextBox,
  type VideoAsset,
} from '../../shared/editor.ts';
import { TextLayer, measureTextBox } from '../text/TextLayer.tsx';
import type { EditKind, TextSelection } from '../../shared/history.ts';

interface Gesture {
  box: TextBox;
  x: number;
  y: number;
  sx: number;
  sy: number;
  handle: ResizeHandle | null;
  target: HTMLElement;
  pointerId: number;
}

export function VideoCanvas({
  video,
  box,
  disabled,
  onChange,
  onCreate,
  onDelete,
  playback,
  onBeginEdit,
  selection,
  historyRevision,
  onSelect,
  onEditText,
  onDeselect,
  onCommit,
}: {
  video: VideoAsset;
  box: TextBox | null;
  disabled: boolean;
  onChange(box: TextBox, kind?: EditKind): void;
  onCreate(x: number, y: number): void;
  onDelete(): void;
  playback: ReactNode;
  onBeginEdit(): void;
  selection: TextSelection;
  historyRevision: number;
  onSelect(): void;
  onEditText(): void;
  onDeselect(): void;
  onCommit(): void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const editing = selection === 'text' && box !== null;
  const [posterError, setPosterError] = useState(false);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setArea({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (editing && input.current && !disabled) {
      input.current.focus({ preventScroll: true });
      input.current.setSelectionRange(
        input.current.value.length,
        input.current.value.length,
      );
    }
  }, [editing, disabled]);
  useLayoutEffect(() => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.target.hasPointerCapture(active.pointerId))
      active.target.releasePointerCapture(active.pointerId);
  }, [historyRevision]);
  const scale = Math.max(
    0.001,
    Math.min(
      (area.width - 80) / (video.width * video.sampleAspectRatio),
      (area.height - 80) / video.height,
    ),
  );
  const sx = scale * video.sampleAspectRatio;
  const sy = scale;
  const finish = () => {
    onSelect();
    stage.current?.focus({ preventScroll: true });
  };
  const remove = () => {
    finishGesture();
    onDelete();
    stage.current?.focus({ preventScroll: true });
  };
  const start = (
    event: PointerEvent<HTMLElement>,
    handle: ResizeHandle | null = null,
  ) => {
    if (!box || disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect();
    gesture.current = {
      box,
      x: event.clientX,
      y: event.clientY,
      sx,
      sy,
      handle,
      target: event.currentTarget,
      pointerId: event.pointerId,
    };
    stage.current?.focus({ preventScroll: true });
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const initial = gesture.current;
    if (!initial || disabled) return;
    const dx = (event.clientX - initial.x) / initial.sx;
    const dy = (event.clientY - initial.y) / initial.sy;
    onChange(
      initial.handle
        ? resizeTextBox(initial.box, initial.handle, dx, dy, measureTextBox)
        : { ...initial.box, x: initial.box.x + dx, y: initial.box.y + dy },
      'gesture',
    );
  };
  const finishGesture = () => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.target.hasPointerCapture(active.pointerId))
      active.target.releasePointerCapture(active.pointerId);
    onCommit();
  };
  return (
    <div
      ref={stage}
      className="video-stage"
      role="group"
      aria-label="Video canvas"
      aria-describedby="canvas-help"
      tabIndex={0}
      onPointerDownCapture={(event) => {
        onBeginEdit();
        if (event.target instanceof HTMLTextAreaElement) onCommit();
      }}
      onKeyDown={(event) => {
        if (
          disabled ||
          !box ||
          event.nativeEvent.isComposing ||
          event.target instanceof HTMLTextAreaElement
        )
          return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (
          event.key === 'Enter' &&
          !(event.target instanceof HTMLButtonElement)
        ) {
          event.preventDefault();
          onBeginEdit();
          if (selection === 'none') onSelect();
          else onEditText();
          return;
        }
        if (event.key === 'Escape') {
          finishGesture();
          onDeselect();
          return;
        }
        if (selection === 'none') return;
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          onBeginEdit();
          remove();
        }
        const steps: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const step = steps[event.key];
        if (step) {
          event.preventDefault();
          onBeginEdit();
          const amount = event.shiftKey ? 10 : 1;
          onChange({
            ...box,
            x: box.x + step[0] * amount,
            y: box.y + step[1] * amount,
          });
        }
      }}
    >
      <div
        className="video-positioner"
        style={{ width: video.width * sx, height: video.height * sy }}
      >
        <img
          className="video-poster"
          src={`app-media://poster/${video.id}`}
          alt="First frame of the imported video"
          draggable={false}
          onError={() => setPosterError(true)}
        />
        {playback}
        <div
          className="video-source-layer"
          style={{
            width: video.width,
            height: video.height,
            transform: `scale(${sx}, ${sy})`,
          }}
          onClick={(event) => {
            if (disabled || event.target instanceof HTMLTextAreaElement) return;
            if (box) finish();
            else {
              const rect = event.currentTarget.getBoundingClientRect();
              onCreate(
                (event.clientX - rect.left) / sx,
                (event.clientY - rect.top) / sy,
              );
            }
          }}
        >
          {box && (
            <TextLayer
              box={box}
              editing={editing && !disabled}
              inputRef={input}
              onChange={(text, kind) => onChange({ ...box, text }, kind)}
              onFinish={finish}
              onEndEditing={onSelect}
              onCommit={onCommit}
            />
          )}
        </div>
        {box && !disabled && (
          <div
            className={`text-selection ${selection === 'none' ? 'not-selected' : 'is-selected'} ${editing ? 'text-editing' : ''}`}
            aria-label="Text box controls"
            role="group"
            tabIndex={0}
            onFocus={(event) => {
              if (event.target === event.currentTarget) onSelect();
            }}
            style={{
              left: box.x * sx,
              top: box.y * sy,
              width: box.width * sx,
              height: box.height * sy,
            }}
            onPointerDown={(event) => start(event)}
            onPointerMove={move}
            onPointerUp={finishGesture}
            onPointerCancel={finishGesture}
            onLostPointerCapture={finishGesture}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onEditText();
            }}
          >
            {HANDLES.map((handle) => (
              <button
                key={handle}
                className={`text-handle handle-${handle}`}
                aria-label={`Resize text ${handle}`}
                title="Resize box without scaling text"
                hidden={selection === 'none'}
                onPointerDown={(event) => start(event, handle)}
              />
            ))}
            <button
              className="text-hover-delete"
              aria-label="Delete text box"
              title="Delete text"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                remove();
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {posterError && (
        <p className="poster-error" role="alert">
          The poster could not load. Reimport the video.
        </p>
      )}
    </div>
  );
}
