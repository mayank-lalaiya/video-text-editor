import { randomUUID } from 'node:crypto';
import type { VideoAsset } from '../../shared/editor.ts';
import {
  PREVIEW_WINDOW_SECONDS,
  type PreviewResult,
} from '../../shared/preview.ts';
import { posterFilters } from './colour.ts';
import { MediaWorker } from './worker.ts';

export function previewArguments(
  path: string,
  asset: VideoAsset,
  videoIndex: number,
  start: number,
  scaleInHardware = false,
): string[] {
  const edge = asset.colour.dynamicRange === 'sdr' ? 720 : 360;
  const scale = Math.min(
    1,
    edge / (asset.width * asset.sampleAspectRatio),
    edge / asset.height,
  );
  const width = Math.max(
    2,
    Math.round((asset.width * asset.sampleAspectRatio * scale) / 2) * 2,
  );
  const height = Math.max(2, Math.round((asset.height * scale) / 2) * 2);
  const args = [
    '-nostdin',
    '-v',
    'error',
    '-filter_threads',
    '8',
    '-hwaccel',
    'videotoolbox',
    ...(scaleInHardware ? ['-hwaccel_output_format', 'videotoolbox_vld'] : []),
    '-ss',
    String(start),
    '-threads',
    '2',
    '-i',
    path,
    '-t',
    String(Math.min(PREVIEW_WINDOW_SECONDS, asset.duration - start)),
    '-map',
    `0:${videoIndex}`,
    '-map',
    '0:a:0?',
    '-vf',
    `fps=15:start_time=0:eof_action=pass,${scaleInHardware ? `scale_vt=w=${width}:h=${height},hwdownload,format=p010le,` : ''}${posterFilters(asset, width, height)},scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=limited,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
    '-c:v',
    'h264_videotoolbox',
    '-profile:v',
    'baseline',
    '-level:v',
    '3.1',
    '-realtime',
    '1',
    // VideoToolbox's low_delay mode is one-in/one-out; realtime alone is a hint.
    '-flags:v',
    '+low_delay',
    '-prio_speed',
    '1',
    '-b:v',
    '700k',
    '-maxrate',
    '1M',
    '-bufsize',
    '2M',
    '-g',
    '15',
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-map_metadata',
    '-1',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '96k',
    '-ar',
    '48000',
    '-af',
    'aresample=async=1:first_pts=0',
    '-movflags',
    '+frag_keyframe+delay_moov+default_base_moof',
    '-frag_duration',
    // Flush within one 15fps frame interval so paused seeks need less preroll.
    '50000',
    '-flush_packets',
    '1',
    '-f',
    'mp4',
    'pipe:1',
  ];
  return args;
}

interface Session {
  id: string;
  controller: AbortController;
  done: Promise<void>;
  file: string;
  args: string[];
  started: boolean;
}

export class PreviewService {
  private session: Session | undefined;
  private revision = 0;
  private retiring: Promise<void> = Promise.resolve();
  private readonly worker: MediaWorker;
  constructor(worker = new MediaWorker()) {
    this.worker = worker;
  }

  async start(
    file: string,
    path: string,
    asset: VideoAsset,
    videoIndex: number,
    start: number,
    scaleInHardware = false,
  ): Promise<PreviewResult> {
    if (start >= asset.duration)
      throw new Error('Seek inside the video duration.');
    const revision = ++this.revision;
    await this.release();
    if (revision !== this.revision) return { ok: true, outcome: 'cancelled' };
    const id = randomUUID();
    this.session = {
      id,
      file,
      args: previewArguments(path, asset, videoIndex, start, scaleInHardware),
      controller: new AbortController(),
      done: Promise.resolve(),
      started: false,
    };
    return {
      ok: true,
      outcome: 'started',
      session: {
        id,
        url: `app-media://preview/${id}`,
        start,
        end: Math.min(asset.duration, start + PREVIEW_WINDOW_SECONDS),
        mime: asset.audioChannels.length
          ? 'video/mp4; codecs="avc1.42E01F, mp4a.40.2"'
          : 'video/mp4; codecs="avc1.42E01F"',
      },
    };
  }

  respond(request: Request): Response {
    const url = new URL(request.url);
    const session = this.session;
    if (
      request.method !== 'GET' ||
      url.search ||
      !session ||
      url.pathname !== `/${session.id}` ||
      session.started
    )
      return new Response('Preview session unavailable.', { status: 404 });
    session.started = true;
    const job = this.worker.stream(
      session.file,
      session.args,
      session.controller,
    );
    session.done = job.done.catch((error: unknown) => {
      if (!session.controller.signal.aborted)
        console.error('Preview encoding failed.', error);
    });
    return new Response(job.body, {
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  private async release(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    session?.controller.abort();
    this.retiring = Promise.all([this.retiring, session?.done]).then(() => {});
    await this.retiring;
  }

  async stop(id?: string): Promise<void> {
    if (id && this.session?.id !== id) return;
    ++this.revision;
    await this.release();
  }
}
