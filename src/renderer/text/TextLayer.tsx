import { useRef, type CSSProperties, type Ref } from 'react';
import type { TextBox } from '../../shared/editor.ts';
import type { EditKind } from '../../shared/history.ts';
import './text.css';

export function textStyle(box: TextBox): CSSProperties {
  return {
    fontFamily: `"${box.font === 'sans' ? 'Editor Noto Sans' : 'Editor Noto Serif'}", "Editor Noto Color Emoji"`,
    fontSize: `${box.fontSize}px`,
    fontWeight: box.bold ? '700' : '400',
    fontStyle: box.italic ? 'italic' : 'normal',
    textAlign: box.align,
    color: box.colour,
    padding: `${box.padding}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
}

export function TextLayer({
  box,
  editing = false,
  inputRef,
  onChange,
  onFinish,
  onEndEditing,
  onCommit,
}: {
  box: TextBox;
  editing?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  onChange?: (text: string, kind: EditKind) => void;
  onFinish?: () => void;
  onEndEditing?: () => void;
  onCommit?: () => void;
}) {
  const composing = useRef(false);
  return (
    <textarea
      ref={inputRef}
      className={`video-text ${editing ? 'editing' : ''}`}
      aria-label="Video text"
      value={box.text}
      readOnly={!editing}
      tabIndex={editing ? 0 : -1}
      placeholder={editing ? 'Enter text' : undefined}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      wrap="soft"
      style={{ ...textStyle(box), left: box.x, top: box.y }}
      onChange={(event) => {
        const native = event.nativeEvent;
        const discrete =
          native instanceof InputEvent &&
          ['insertFromPaste', 'insertFromDrop', 'deleteByCut'].includes(
            native.inputType,
          );
        onChange?.(
          event.target.value,
          composing.current ? 'composition' : discrete ? 'discrete' : 'typing',
        );
      }}
      onBlur={() => {
        if (editing) onEndEditing?.();
      }}
      onSelect={(event) => {
        if (
          event.currentTarget.selectionStart !==
          event.currentTarget.selectionEnd
        )
          onCommit?.();
      }}
      onCompositionStart={() => {
        onCommit?.();
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        onCommit?.();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (
          [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown',
          ].includes(event.key)
        )
          onCommit?.();
        if (
          event.key === 'Escape' ||
          (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
        ) {
          event.preventDefault();
          event.stopPropagation();
          onFinish?.();
        }
      }}
    />
  );
}

let lastAdvance: { key: string; width: number } | undefined;

export function measureTextBox(box: TextBox): {
  width: number;
  height: number;
} {
  const host = document.createElement('div');
  host.className = 'text-measure-host';
  const span = document.createElement('span');
  span.className = 'video-text';
  Object.assign(span.style, textStyle(box), {
    position: 'static',
    width: 'auto',
    height: 'auto',
    padding: '0px',
    whiteSpace: 'pre',
  });
  const textarea = document.createElement('textarea');
  textarea.className = 'video-text';
  Object.assign(textarea.style, textStyle(box));
  textarea.value = box.text || ' ';
  host.append(span, textarea);
  document.body.append(host);
  try {
    const renderedSize = parseFloat(getComputedStyle(span).fontSize);
    if (Math.abs(renderedSize - box.fontSize) > 0.01)
      throw new Error(
        `Font size ${box.fontSize} cannot be rendered accurately. Choose a smaller supported size.`,
      );
    const key = JSON.stringify([
      box.font,
      box.fontSize,
      box.bold,
      box.italic,
      box.text,
    ]);
    let advance = lastAdvance?.key === key ? lastAdvance.width : 1;
    if (lastAdvance?.key !== key) {
      for (const { segment } of new Intl.Segmenter('en', {
        granularity: 'grapheme',
      }).segment(box.text)) {
        if (segment === '\n' || segment === '\r') continue;
        span.textContent = segment;
        advance = Math.max(advance, span.getBoundingClientRect().width);
      }
      lastAdvance = { key, width: advance };
    }
    const width = Math.max(box.width, Math.ceil(advance + box.padding * 2 + 1));
    textarea.style.width = `${width}px`;
    textarea.style.height = '0px';
    return { width, height: Math.max(1, textarea.scrollHeight + 1) };
  } finally {
    host.remove();
  }
}
