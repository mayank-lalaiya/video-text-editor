import type { ReactNode, RefCallback } from 'react';
import { VideoIcon } from './VideoIcon.tsx';
import { VideoCanvas } from './VideoCanvas.tsx';
import type { TextBox, VideoAsset } from '../../shared/editor.ts';
import type { PreviewControls } from '../usePreview.ts';
import type { EditKind, TextSelection } from '../../shared/history.ts';

function timecode(time: number): string {
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PreviewArea({
  children,
  video,
  box,
  busy,
  playbackDisabled = false,
  onChange,
  onCreate,
  onDelete,
  preview,
  videoRef,
  selection,
  historyRevision,
  onSelect,
  onEditText,
  onDeselect,
  onCommit,
}: {
  children: ReactNode;
  video: VideoAsset | null;
  box: TextBox | null;
  busy: boolean;
  playbackDisabled?: boolean;
  onChange(box: TextBox, kind?: EditKind): void;
  onCreate(x: number, y: number): void;
  onDelete(): void;
  preview: PreviewControls;
  videoRef: RefCallback<HTMLVideoElement>;
  selection: TextSelection;
  historyRevision: number;
  onSelect(): void;
  onEditText(): void;
  onDeselect(): void;
  onCommit(): void;
}) {
  return (
    <main className="preview-area" aria-labelledby="preview-heading">
      <div className="preview-heading">
        <h2 id="preview-heading">Preview</h2>
        <span className="secondary">
          {video
            ? video.colour.dynamicRange === 'sdr'
              ? 'Low-quality preview / Full-duration text'
              : 'SDR preview; HDR export'
            : 'No video selected'}
        </span>
      </div>
      {video ? (
        <>
          <VideoCanvas
            key={video.id}
            video={video}
            box={box}
            disabled={busy}
            onChange={onChange}
            onCreate={onCreate}
            onDelete={onDelete}
            onBeginEdit={preview.pause}
            selection={selection}
            historyRevision={historyRevision}
            onSelect={onSelect}
            onEditText={onEditText}
            onDeselect={onDeselect}
            onCommit={onCommit}
            playback={
              <video
                ref={videoRef}
                className={`video-playback ${preview.ready ? 'is-ready' : ''}`}
                muted={preview.muted}
                playsInline
                aria-label="Video preview"
                disablePictureInPicture
              />
            }
          />
          <p className="canvas-help" id="canvas-help">
            {box
              ? 'Drag to move. Double-click or press Enter on the selected box to type. Handles resize the box, not the font.'
              : 'Click the video to add text.'}
          </p>
        </>
      ) : (
        <div className="preview-stage">
          <div className="preview-empty">
            <div className="empty-icon">
              <VideoIcon size={56} />
            </div>
            <span className="eyebrow">YOUR VIDEO. YOUR WORDS.</span>
            <h1>A clean canvas for your next video</h1>
            <p>
              Import your clips, place your text, and export.
              <br />
              Everything stays on your Mac.
            </p>
            <p className="milestone-note">
              Use Import videos above or drop files here to begin.
              <br />
              Apply text to all clips, then play and check each before
              exporting.
            </p>
          </div>
        </div>
      )}
      <div className="resource-container">{children}</div>
      {preview.error && (
        <div className="notice error" role="alert">
          <p>{preview.error}</p>
          <button
            className="button"
            disabled={busy}
            onClick={() => preview.seek(preview.time)}
          >
            Retry preview
          </button>
        </div>
      )}
      <div className="playback-bar" aria-label="Playback controls">
        <button
          className="button quiet play-button"
          disabled={!video || busy || playbackDisabled}
          aria-label={preview.playing ? 'Pause video' : 'Play video'}
          onClick={preview.toggle}
        >
          <span className={preview.playing ? 'pause-icon' : 'play-icon'} />
        </button>
        <span className="timecode">
          {video ? timecode(preview.time) : '--:--'}
        </span>
        <input
          type="range"
          min="0"
          max={video?.duration ?? 1}
          step="0.01"
          value={preview.time}
          disabled={!video || busy || playbackDisabled}
          aria-label="Video playhead"
          aria-valuetext={timecode(preview.time)}
          onChange={(event) => preview.seek(Number(event.target.value))}
        />
        <span className="timecode">
          {video ? timecode(video.duration) : '--:--'}
        </span>
        <button
          className="button quiet"
          disabled={!video || busy}
          aria-label="Mute preview"
          title="Preview audio only (first track). Export retains all audio tracks."
          aria-pressed={preview.muted}
          onClick={preview.toggleMute}
        >
          {preview.muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
      {preview.loading && (
        <span className="preview-loading" role="status">
          Buffering preview...
        </span>
      )}
    </main>
  );
}
