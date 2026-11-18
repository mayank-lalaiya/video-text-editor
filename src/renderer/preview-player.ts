import type { VideoAsset } from '../shared/editor.ts';
import { getDesktopApi } from './desktop.ts';

export interface PlaybackState {
  time: number;
  playing: boolean;
  loading: boolean;
  ready: boolean;
  error: string | null;
}

interface Pipeline {
  controller: AbortController;
  source: MediaSource;
  url: string;
  buffer?: SourceBuffer;
  sessionId?: string;
  next: number;
  feeding: boolean;
  positioned: boolean;
}

function updateBuffer(
  buffer: SourceBuffer,
  signal: AbortSignal,
  operation: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      buffer.removeEventListener('updateend', complete);
      buffer.removeEventListener('error', failed);
      signal.removeEventListener('abort', failed);
    };
    const complete = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(
        new Error(
          signal.aborted
            ? 'Preview cancelled.'
            : 'Preview buffer could not decode the stream.',
        ),
      );
    };
    if (signal.aborted) {
      failed();
      return;
    }
    buffer.addEventListener('updateend', complete, { once: true });
    buffer.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', failed, { once: true });
    try {
      operation();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export class PreviewPlayer {
  private readonly element: HTMLVideoElement;
  private readonly asset: VideoAsset;
  private readonly changed: (state: PlaybackState) => void;
  private pipeline: Pipeline | undefined;
  private state: PlaybackState = {
    time: 0,
    playing: false,
    loading: false,
    ready: false,
    error: null,
  };
  constructor(
    element: HTMLVideoElement,
    asset: VideoAsset,
    changed: (state: PlaybackState) => void,
    initialTime = 0,
  ) {
    this.element = element;
    this.asset = asset;
    this.changed = changed;
    element.addEventListener('loadeddata', this.ready);
    element.addEventListener('timeupdate', this.time);
    element.addEventListener('waiting', this.waiting);
    element.addEventListener('playing', this.started);
    element.addEventListener('ended', this.ended);
    element.addEventListener('error', this.failed);
    if (initialTime > 0) this.seek(initialTime);
  }
  private update(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private ready = () => {
    this.update({ ready: true, loading: false });
    if (this.state.playing) this.playElement();
  };
  private time = () => {
    if (!this.pipeline?.positioned) return;
    if (this.element.readyState < 2) return;
    this.update({
      time: Math.min(this.asset.duration, this.element.currentTime),
    });
    this.prefetch();
  };
  private waiting = () => {
    if (this.state.playing) this.update({ loading: true });
    this.prefetch();
  };
  private started = () => this.update({ loading: false });
  private ended = () =>
    this.update({ playing: false, loading: false, time: this.asset.duration });
  private failed = () => {
    if (this.pipeline)
      this.fail(
        this.pipeline,
        new Error(
          `Preview decoding failed: ${this.element.error?.message ?? 'unknown media error'}`,
        ),
      );
  };
  private fail(pipeline: Pipeline, error: unknown) {
    if (this.pipeline !== pipeline || pipeline.controller.signal.aborted)
      return;
    console.error('Preview playback failed.', error);
    this.pause();
    this.update({
      loading: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    });
    this.release();
  }
  private playElement() {
    const pipeline = this.pipeline;
    void this.element.play().catch((error: unknown) => {
      if (pipeline) this.fail(pipeline, error);
    });
  }
  pause() {
    this.element.pause();
    this.update({ playing: false });
  }
  stop() {
    this.pause();
    this.release();
    this.update({ ready: false, loading: false });
  }
  toggle() {
    if (this.state.playing) {
      this.pause();
      return;
    }
    this.update({ playing: true, error: null });
    if (!this.pipeline || this.state.time >= this.asset.duration - 0.01)
      this.seek(
        this.state.time >= this.asset.duration - 0.01 ? 0 : this.state.time,
      );
    else if (this.state.ready) this.playElement();
  }
  seek(time: number) {
    this.release();
    const start = Math.max(0, Math.min(time, this.asset.duration - 0.001));
    const source = new MediaSource();
    const pipeline: Pipeline = {
      source,
      controller: new AbortController(),
      url: URL.createObjectURL(source),
      next: start,
      feeding: false,
      positioned: false,
    };
    this.pipeline = pipeline;
    this.update({ time: start, loading: true, ready: false, error: null });
    source.addEventListener(
      'sourceopen',
      () => {
        if (pipeline.controller.signal.aborted) return;
        source.duration = this.asset.duration;
        this.element.currentTime = start;
        void this.feed(pipeline);
      },
      { once: true },
    );
    this.element.src = pipeline.url;
  }
  private prefetch() {
    const pipeline = this.pipeline;
    if (
      !pipeline ||
      !this.state.playing ||
      pipeline.feeding ||
      pipeline.next >= this.asset.duration ||
      pipeline.source.readyState !== 'open'
    )
      return;
    const ranges = this.element.buffered;
    const end = ranges.length
      ? ranges.end(ranges.length - 1)
      : this.element.currentTime;
    if (end - this.element.currentTime < 3) void this.feed(pipeline);
  }
  private async feed(pipeline: Pipeline) {
    if (pipeline.feeding || pipeline.controller.signal.aborted) return;
    pipeline.feeding = true;
    const { signal } = pipeline.controller;
    try {
      const result = await getDesktopApi().startPreview({
        assetId: this.asset.id,
        start: pipeline.next,
      });
      if (!result.ok) throw new Error(result.error);
      if (result.outcome === 'cancelled') {
        if (!signal.aborted)
          throw new Error('Preview was replaced. Retry playback.');
        return;
      }
      const session = result.session;
      if (signal.aborted) {
        await this.stopSession(session.id);
        return;
      }
      pipeline.sessionId = session.id;
      if (!pipeline.buffer) {
        if (!MediaSource.isTypeSupported(session.mime))
          throw new Error(
            'This desktop runtime cannot play the required H.264/AAC MediaSource stream.',
          );
        pipeline.buffer = pipeline.source.addSourceBuffer(session.mime);
      }
      const buffer = pipeline.buffer;
      const cutoff = this.element.currentTime - 2;
      if (
        cutoff > 0 &&
        buffer.buffered.length &&
        buffer.buffered.start(0) < cutoff
      )
        await updateBuffer(buffer, signal, () => buffer.remove(0, cutoff));
      buffer.timestampOffset = session.start;
      // Keep the final partial preview frame, including one-frame source clips.
      buffer.appendWindowEnd =
        session.end >= this.asset.duration ? session.end + 1 / 15 : session.end;
      buffer.appendWindowStart = session.start;
      const response = await fetch(session.url, { signal });
      if (!response.ok || !response.body)
        throw new Error(
          `Preview stream unavailable (${response.status}). Retry playback.`,
        );
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          await updateBuffer(buffer, signal, () =>
            buffer.appendBuffer(chunk.value.slice().buffer),
          );
          if (!pipeline.positioned && buffer.buffered.length) {
            pipeline.positioned = true;
            this.element.currentTime = Math.max(
              session.start,
              buffer.buffered.start(0),
            );
          }
        }
      } finally {
        reader.releaseLock();
      }
      pipeline.next = session.end;
      if (
        pipeline.next >= this.asset.duration &&
        pipeline.source.readyState === 'open'
      )
        pipeline.source.endOfStream();
    } catch (error) {
      if (!signal.aborted) this.fail(pipeline, error);
    } finally {
      pipeline.feeding = false;
      this.prefetch();
    }
  }
  private async stopSession(id: string) {
    const result = await getDesktopApi().stopPreview(id);
    if (!result.ok) throw new Error(result.error);
  }
  private release() {
    const pipeline = this.pipeline;
    this.pipeline = undefined;
    if (!pipeline) return;
    pipeline.controller.abort();
    if (pipeline.sessionId)
      void this.stopSession(pipeline.sessionId).catch((error: unknown) => {
        console.error('Preview worker could not be stopped.', error);
        this.update({ error: `Preview cleanup failed: ${String(error)}` });
      });
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    URL.revokeObjectURL(pipeline.url);
  }
  dispose() {
    this.element.removeEventListener('loadeddata', this.ready);
    this.element.removeEventListener('timeupdate', this.time);
    this.element.removeEventListener('waiting', this.waiting);
    this.element.removeEventListener('playing', this.started);
    this.element.removeEventListener('ended', this.ended);
    this.element.removeEventListener('error', this.failed);
    this.release();
  }
}
