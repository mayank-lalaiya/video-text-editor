import { dialog, protocol, shell, type BrowserWindow } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { SourceReference } from '../workspace/store.ts';
import {
  readFile,
  realpath,
  stat,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type {
  VideoAsset,
  ExportRequest,
  ExportResult,
  ExportProgress,
} from '../../shared/editor.ts';
import { MediaWorker } from './worker.ts';
import {
  describeVideo,
  probeVideo,
  reportedFrameCountsMatch,
  validateOutput,
  validateHdrFrames,
  videoStream,
  sourceVideoBitrate,
  type Probe,
} from './probe.ts';
import { rasterizeText } from './text-overlay.ts';
import { readManifest } from '../resources/manifest.ts';
import { publishOutput } from './publish.ts';
import { exportPlan, posterFilters } from './colour.ts';
import { PreviewService } from './preview.ts';
import type { PreviewRequest, PreviewResult } from '../../shared/preview.ts';
import { mediaToolPath } from '../platform.ts';

interface Source {
  asset: VideoAsset;
  path: string;
  probe: Probe;
  identity: string;
  poster: string;
  hash: string;
}
const identity = (info: Awaited<ReturnType<typeof stat>>) =>
  `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;

async function hashSource(path: string, signal: AbortSignal): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, {
    signal,
    highWaterMark: 4 * 1024 * 1024,
  }))
    digest.update(chunk);
  return digest.digest('hex');
}

async function removeExportDirectory(
  directory: string,
  completed?: Extract<ExportResult, { outcome: 'completed' }>,
): Promise<void> {
  try {
    await rm(directory, { recursive: true });
  } catch (error) {
    const failure = new Error(
      `Temporary export files could not be removed: ${directory}`,
      { cause: error },
    );
    if (!completed) throw failure;
    console.error('Published output retained after cleanup failure.', failure);
    completed.warning = failure.message;
  }
}

export class MediaService {
  private readonly sources = new Map<string, Source>();
  outputFolder: string | null = null;
  onOutputFolderChanged: (() => Promise<void>) | undefined;
  private readonly worker: MediaWorker;
  private readonly preview: PreviewService;
  private exportDirectory: string | undefined;
  private previewRequest = 0;
  private readonly outputs = new Map<string, string>();
  private active:
    | { controller: AbortController; done: Promise<unknown> }
    | undefined;
  private importing:
    | { controller: AbortController; done: Promise<void> }
    | undefined;
  private progress: ExportProgress = { phase: 'idle', fraction: 0 };
  private readonly resources: string;
  private readonly temporaryDirectory: string;
  constructor(resources: string, temporaryDirectory: string) {
    this.resources = resources;
    this.temporaryDirectory = temporaryDirectory;
    this.worker = new MediaWorker({
      file: join(resources, mediaToolPath('media-guardian')),
      cleanupDirectories: () => [
        temporaryDirectory,
        ...(this.exportDirectory ? [this.exportDirectory] : []),
      ],
    });
    this.preview = new PreviewService(this.worker);
  }

  private async tool(name: 'ffmpeg' | 'ffprobe'): Promise<string> {
    const entry = (await readManifest(this.resources)).resources.find(
      (item) => item.id === name && item.kind === 'tool',
    );
    if (!entry)
      throw new Error(`The bundled ${name} is missing from the manifest.`);
    return join(this.resources, entry.relativePath);
  }
  getProgress(): ExportProgress {
    return { ...this.progress };
  }
  isBusy(): boolean {
    return !!this.active || !!this.importing;
  }

  registerPosterProtocol(): void {
    protocol.handle('app-media', async (request) => {
      const url = new URL(request.url);
      if (url.hostname === 'preview') return this.preview.respond(request);
      const source = this.sources.get(url.pathname.slice(1));
      if (request.method !== 'GET' || url.hostname !== 'poster' || !source)
        return new Response('Unknown poster.', { status: 404 });
      try {
        return new Response(await readFile(source.poster), {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        console.error('Video poster unavailable.', error);
        return new Response('Video poster unavailable. Reimport the source.', {
          status: 503,
        });
      }
    });
  }

  async importVideo(
    selected: string,
    restore?: { id: string; reference: SourceReference; relink?: boolean },
  ): Promise<VideoAsset> {
    if (this.isBusy()) throw new Error('Wait for the current media operation.');
    if (!['.mp4', '.mov'].includes(extname(selected).toLowerCase()))
      throw new Error('Select an MP4 or MOV video.');
    const controller = new AbortController();
    const settled = Promise.withResolvers<void>();
    this.importing = { controller, done: settled.promise };
    let poster: string | undefined;
    try {
      await this.preview.stop();
      const path = await realpath(selected);
      const info = await stat(path);
      if (!info.isFile())
        throw new Error('The selected source is not a regular file.');
      if (
        !restore &&
        [...this.sources.values()].some(
          (source) =>
            source.path === path ||
            source.identity.split(':').slice(0, 2).join(':') ===
              identity(info).split(':').slice(0, 2).join(':'),
        )
      )
        throw new Error(
          `Already imported: ${basename(selected)}. Existing edits were kept.`,
        );
      if (
        restore &&
        !restore.relink &&
        identity(info) !== restore.reference.identity
      )
        throw new Error(
          'Source changed since the last save. Locate the original matching video to recover its edits.',
        );
      const probing = probeVideo(
        this.worker,
        await this.tool('ffprobe'),
        path,
        controller.signal,
      );
      const hashing =
        restore && !restore.relink
          ? Promise.resolve(restore.reference.hash)
          : hashSource(path, controller.signal);
      const [probe, hash] = await Promise.all([probing, hashing]).catch(
        async (error: unknown) => {
          controller.abort();
          await Promise.allSettled([probing, hashing]);
          throw error;
        },
      );
      const asset = describeVideo(
        probe,
        restore?.id ?? randomUUID(),
        basename(selected),
      );
      if (restore && hash !== restore.reference.hash)
        throw new Error(
          'The selected file does not match the original video. Its saved text was not changed.',
        );
      await mkdir(this.temporaryDirectory, { recursive: true });
      poster = join(this.temporaryDirectory, `${randomUUID()}.png`);
      const posterScale = Math.min(1, 720 / asset.width, 720 / asset.height);
      const posterWidth = Math.max(1, Math.round(asset.width * posterScale));
      const posterHeight = Math.max(1, Math.round(asset.height * posterScale));
      await this.worker.run(
        await this.tool('ffmpeg'),
        [
          '-nostdin',
          '-v',
          'error',
          '-i',
          path,
          '-map',
          `0:${videoStream(probe).index}`,
          '-frames:v',
          '1',
          '-vf',
          posterFilters(asset, posterWidth, posterHeight),
          '-an',
          '-update',
          '1',
          poster,
        ],
        controller.signal,
      );
      if (identity(await stat(path)) !== identity(info))
        throw new Error(
          'The video changed while it was being imported. Try importing it again.',
        );
      const previous = this.sources.get(asset.id);
      if (previous) await rm(previous.poster, { force: true });
      this.sources.set(asset.id, {
        asset,
        path,
        probe,
        identity: identity(info),
        poster,
        hash,
      });
      this.outputs.clear();
      poster = undefined;
      return asset;
    } finally {
      controller.abort();
      try {
        if (poster) await rm(poster, { force: true });
      } finally {
        this.importing = undefined;
        settled.resolve();
      }
    }
  }

  async exportVideo(
    request: ExportRequest,
    parent: BrowserWindow,
    options?: { destination: string; suffix: number; directory: string },
  ): Promise<ExportResult> {
    if (this.isBusy()) throw new Error('A media operation is already running.');
    const source = this.sources.get(request.assetId);
    if (!source || request.assetId !== source.asset.id)
      throw new Error('The selected video is no longer available.');
    if (!request.textBox.text.trim())
      throw new Error('Add non-empty text before exporting.');
    const controller = new AbortController();
    const done = this.performExport(
      source,
      request,
      parent,
      controller,
      options,
    );
    this.active = { controller, done };
    try {
      return await done;
    } finally {
      this.active = undefined;
      this.progress = { phase: 'idle', fraction: 0 };
    }
  }

  async inspectExport(id: string) {
    const source = this.sources.get(id);
    if (!source)
      throw new Error('Source unavailable. Locate the original video.');
    if (identity(await stat(source.path)) !== source.identity)
      throw new Error(
        'The original video changed. Locate the matching original.',
      );
    return structuredClone({
      ...source.asset,
      codec: videoStream(source.probe).codec_name,
    });
  }
  isExporting(): boolean {
    return !!this.active;
  }

  async startPreview(request: PreviewRequest): Promise<PreviewResult> {
    const revision = ++this.previewRequest;
    if (this.isBusy()) throw new Error('Wait for the current media operation.');
    const source = this.sources.get(request.assetId);
    if (!source || request.assetId !== source.asset.id)
      throw new Error('The selected video is no longer available.');
    const file = await this.tool('ffmpeg');
    if (identity(await stat(source.path)) !== source.identity)
      throw new Error(
        'The original video changed. Reimport it before playback.',
      );
    if (revision !== this.previewRequest)
      return { ok: true, outcome: 'cancelled' };
    if (this.sources.get(request.assetId) !== source || this.isBusy())
      throw new Error('The active video changed before playback.');
    const video = videoStream(source.probe);
    // A zero-degree display matrix can still mirror the picture.
    const scaleInHardware =
      source.asset.colour.dynamicRange !== 'sdr' &&
      source.asset.rotation === 0 &&
      !video.side_data_list?.some(
        (side) => side.side_data_type === 'Display Matrix',
      ) &&
      video.codec_name === 'hevc' &&
      video.pix_fmt === 'yuv420p10le';
    return this.preview.start(
      file,
      source.path,
      source.asset,
      video.index,
      request.start,
      scaleInHardware,
    );
  }

  async stopPreview(id?: string): Promise<void> {
    if (!id) ++this.previewRequest;
    await this.preview.stop(id);
  }

  private async performExport(
    source: Source,
    request: ExportRequest,
    parent: BrowserWindow,
    controller: AbortController,
    options?: { destination: string; suffix: number; directory: string },
  ): Promise<ExportResult> {
    let directory: string | undefined;
    let completed: Extract<ExportResult, { outcome: 'completed' }> | undefined;
    try {
      await this.preview.stop();
      this.progress = { phase: 'choosing', fraction: 0 };
      const folder = options
        ? { canceled: false, filePaths: [options.destination] }
        : await dialog.showOpenDialog(parent, {
            title: 'Choose a folder for the edited video',
            ...(this.outputFolder ? { defaultPath: this.outputFolder } : {}),
            properties: ['openDirectory', 'createDirectory'],
          });
      if (folder.canceled || controller.signal.aborted)
        return { ok: true, outcome: 'cancelled' };
      const destination = folder.filePaths[0];
      if (!destination) throw new Error('No output folder was selected.');
      if (!options) {
        this.outputFolder = destination;
        await this.onOutputFolderChanged?.();
      }
      if (identity(await stat(source.path)) !== source.identity)
        throw new Error(
          'The original video changed. Reimport it before exporting.',
        );
      if (options) {
        await mkdir(options.directory);
        directory = options.directory;
      } else
        directory = await mkdtemp(join(destination, '.video-text-editor-'));
      this.exportDirectory = directory;
      this.progress = { phase: 'rendering', fraction: 0 };
      const overlay = await rasterizeText(
        {
          width: source.asset.width,
          height: source.asset.height,
          textBox: request.textBox,
        },
        controller.signal,
      );
      const overlayPath = join(directory, 'text.png');
      await writeFile(overlayPath, overlay, { flag: 'wx' });
      const partial = join(directory, 'output.mp4');
      this.progress = { phase: 'encoding', fraction: 0 };
      const bitrate = await sourceVideoBitrate(
        this.worker,
        await this.tool('ffprobe'),
        source.path,
        source.probe,
        controller.signal,
      );
      const plan = exportPlan(
        source.asset,
        videoStream(source.probe).index,
        bitrate,
        videoStream(source.probe).codec_name,
      );
      const args = [
        '-nostdin',
        '-v',
        'error',
        '-i',
        source.path,
        '-i',
        overlayPath,
        '-filter_complex',
        plan.filter,
        '-map',
        '[out]',
        '-map',
        '0:a?',
        ...plan.encodingArgs,
        '-fps_mode',
        'passthrough',
      ];
      source.probe.streams
        .filter((stream) => stream.codec_type === 'audio')
        .forEach((stream, index) => {
          args.push(
            `-c:a:${index}`,
            stream.codec_name === 'aac' ? 'copy' : 'aac',
          );
          if (stream.codec_name !== 'aac') {
            if (!stream.channels)
              throw new Error('Source audio channel metadata is missing.');
            args.push(`-b:a:${index}`, `${stream.channels * 128}k`);
          }
        });
      args.push(
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        '-nostats',
        partial,
      );
      await this.worker.run(
        await this.tool('ffmpeg'),
        args,
        controller.signal,
        (microseconds) => {
          this.progress = {
            phase: controller.signal.aborted ? 'stopping' : 'encoding',
            fraction: Math.min(
              0.99,
              microseconds / 1e6 / source.asset.duration,
            ),
          };
        },
      );
      this.progress = { phase: 'validating', fraction: 0.99 };
      const ffprobe = await this.tool('ffprobe');
      let reference = source.probe;
      let encoded = await probeVideo(
        this.worker,
        ffprobe,
        partial,
        controller.signal,
      );
      if (!reportedFrameCountsMatch(reference, encoded)) {
        // MP4 edit lists can hide samples included in the container's frame total.
        reference = await probeVideo(
          this.worker,
          ffprobe,
          source.path,
          controller.signal,
          {
            countFrames: true,
          },
        );
        encoded = await probeVideo(
          this.worker,
          ffprobe,
          partial,
          controller.signal,
          {
            countFrames: true,
          },
        );
      }
      validateOutput(reference, encoded, source.asset);
      if (source.asset.colour.dynamicRange !== 'sdr')
        await validateHdrFrames(
          this.worker,
          ffprobe,
          partial,
          controller.signal,
        );
      if (identity(await stat(source.path)) !== source.identity)
        throw new Error(
          'The original changed during export. No output was published.',
        );
      if (controller.signal.aborted) return { ok: true, outcome: 'cancelled' };
      const output = await publishOutput(
        partial,
        destination,
        source.asset.name,
        controller.signal,
        options?.suffix,
      );
      const id = randomUUID();
      this.outputs.clear();
      this.outputs.set(id, output);
      completed = { ok: true, outcome: 'completed', id, path: output };
      return completed;
    } catch (error) {
      if (controller.signal.aborted) {
        console.info('Export stopped before completion.', error);
        return { ok: true, outcome: 'cancelled' };
      }
      throw error;
    } finally {
      try {
        if (directory) await removeExportDirectory(directory, completed);
      } finally {
        this.exportDirectory = undefined;
      }
    }
  }

  cancel(): void {
    this.importing?.controller.abort();
    if (this.active) {
      this.progress = { ...this.progress, phase: 'stopping' };
      this.active.controller.abort();
    }
  }

  reference(id: string): SourceReference {
    const source = this.sources.get(id);
    if (!source) throw new Error('Source is unavailable.');
    return { path: source.path, identity: source.identity, hash: source.hash };
  }

  async removeSource(id: string): Promise<void> {
    if (this.isBusy()) throw new Error('Wait for the current media operation.');
    try {
      await this.stopPreview();
      const source = this.sources.get(id);
      if (source) await rm(source.poster, { force: true });
    } finally {
      this.sources.delete(id);
      this.outputs.clear();
    }
  }

  reveal(id: string): void {
    const path = this.outputs.get(id);
    if (!path) throw new Error('No completed export with that ID exists.');
    shell.showItemInFolder(path);
  }

  async dispose(): Promise<void> {
    const importing = this.importing;
    importing?.controller.abort();
    this.cancel();
    await this.preview.stop();
    if (this.active) {
      try {
        await this.active.done;
      } catch (error) {
        console.error(
          'Export failed while the application was closing.',
          error,
        );
      }
    }
    if (importing) await importing.done;
    await rm(this.temporaryDirectory, { recursive: true, force: true });
  }
}
