import { randomUUID } from 'node:crypto';
import {
  link,
  open,
  readFile,
  rename,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import { join, parse } from 'node:path';
import type { MediaService } from './service.ts';
import { exportCodec } from './colour.ts';
import type { ExportRequest, ExportResult } from '../../shared/editor.ts';
import type { Workspace } from '../../shared/workspace.ts';
import {
  ExportQueueSchema,
  queueRunning,
  type ExportJob,
  type ExportQueue,
  type ExportScope,
} from '../../shared/export-queue.ts';

type QueueMedia = Pick<
  MediaService,
  | 'inspectExport'
  | 'getProgress'
  | 'cancel'
  | 'isBusy'
  | 'outputFolder'
  | 'onOutputFolderChanged'
>;
type RenderJob = (
  request: ExportRequest,
  options: { destination: string; suffix: number; directory: string },
) => Promise<ExportResult>;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export class ExportQueueService {
  private readonly media: QueueMedia;
  private readonly record: string;
  private state: ExportQueue | null = null;
  private stopped = false;
  private done: Promise<void> | null = null;
  private loading: Promise<void> | undefined;
  private preparing = false;
  private lastResults: ExportQueue | null = null;
  private closing = false;
  private readonly render: RenderJob;

  constructor(media: QueueMedia, record: string, render: RenderJob) {
    this.media = media;
    this.record = record;
    this.render = render;
  }
  async load(): Promise<void> {
    this.loading ??= this.restore().catch((error: unknown) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }
  private async restore(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.record, 'utf8');
    } catch (error) {
      if (missing(error)) return;
      throw new Error(`Could not read the export record: ${this.record}`, {
        cause: error,
      });
    }
    try {
      this.state = ExportQueueSchema.parse(JSON.parse(content));
    } catch (error) {
      console.error('Unreadable export record.', error);
      const archive = `${this.record}.damaged-${randomUUID()}`;
      await rename(this.record, archive);
      this.state = {
        id: randomUUID(),
        scope: 'all',
        status: 'interrupted',
        folder: null,
        folderError: null,
        freeBytes: null,
        jobs: [],
        phase: 'idle',
        fraction: 0,
        notice: `The previous export record was unreadable and was preserved at ${archive}. No export was restarted; inspect the output folder before trying again.`,
      };
      await this.save();
      return;
    }
    if (queueRunning(this.state)) {
      this.state.status = 'interrupted';
      this.state.phase = 'idle';
      this.state.fraction = 0;
      this.state.notice =
        'Previous export interrupted. Unfinished jobs were not restarted. Completed outputs remain; partial files are not completed exports.';
      for (const job of this.state.jobs) {
        if (job.status === 'queued' || job.status === 'exporting') {
          job.status = 'interrupted';
          job.error =
            'Interrupted before completion was recorded. Inspect the output folder before exporting again.';
        }
      }
      await this.save();
    }
  }
  private async save(document = this.state): Promise<void> {
    const temporary = `${this.record}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(document));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.record);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  isRunning(): boolean {
    return this.done !== null;
  }
  setClosing(closing: boolean): void {
    this.closing = closing;
  }
  async wait(): Promise<void> {
    await this.done;
  }
  snapshot(): ExportQueue | null {
    const state = structuredClone(this.state);
    if (state && queueRunning(state)) {
      const progress = this.media.getProgress();
      state.phase = this.stopped ? 'stopping' : progress.phase;
      state.fraction = progress.fraction;
    }
    return state;
  }
  async prepare(scope: ExportScope, workspace: Workspace): Promise<void> {
    await this.load();
    if (
      this.closing ||
      this.isRunning() ||
      this.preparing ||
      this.media.isBusy()
    )
      throw new Error('Wait for the current media operation.');
    this.preparing = true;
    try {
      if (this.state?.status !== 'preflight') this.lastResults = this.state;
      const failed =
        this.lastResults?.jobs.filter((job) => job.status === 'failed') ?? [];
      const ids =
        scope === 'retry'
          ? failed.map((job) => job.assetId)
          : workspace.entries
              .filter(
                (entry) =>
                  scope === 'all' ||
                  (scope === 'current'
                    ? entry.asset.id === workspace.activeId
                    : entry.checked),
              )
              .map((entry) => entry.asset.id);
      const jobs: ExportJob[] = [];
      for (const id of ids) {
        const entry = workspace.entries.find((item) => item.asset.id === id);
        const job: ExportJob = {
          assetId: id,
          name:
            entry?.asset.name ??
            failed.find((item) => item.assetId === id)?.name ??
            id,
          format: '',
          filename: '',
          suffix: 1,
          textBox: entry?.text?.box ? structuredClone(entry.text.box) : null,
          status: 'ready',
          error: null,
          path: null,
          temporaryPath: null,
        };
        try {
          if (!entry) throw new Error('Video removed from workspace.');
          if (entry.issue) throw new Error(entry.issue);
          const asset = await this.media.inspectExport(id);
          job.format =
            asset.colour.dynamicRange === 'sdr'
              ? asset.colour.bitDepth === 8
                ? `${exportCodec(asset, asset.codec) === 'hevc' ? 'HEVC Main' : 'H.264'} / 8-bit SDR MP4`
                : 'HEVC Main10 / 10-bit SDR MP4'
              : `HEVC Main10 / ${asset.colour.dynamicRange.toUpperCase()} HDR MP4`;
          if (!job.textBox?.text.trim()) {
            job.status = 'skipped';
            job.error = 'No non-empty text.';
          }
        } catch (error) {
          job.status = 'blocked';
          job.error = message(error);
        }
        jobs.push(job);
      }
      this.state = {
        id: randomUUID(),
        scope,
        status: 'preflight',
        folder: this.media.outputFolder,
        folderError: null,
        freeBytes: null,
        jobs,
        phase: 'idle',
        fraction: 0,
        notice: null,
      };
      await this.validateFolder();
    } finally {
      this.preparing = false;
    }
  }
  async setFolder(folder: string): Promise<void> {
    if (this.closing || this.state?.status !== 'preflight' || this.preparing)
      throw new Error('Open export preflight first.');
    this.preparing = true;
    const previous = structuredClone(this.state);
    const previousFolder = this.media.outputFolder;
    try {
      this.state.folder = folder;
      await this.validateFolder();
      if (!this.state.folderError) {
        this.media.outputFolder = folder;
        await this.media.onOutputFolderChanged?.();
      }
    } catch (error) {
      this.state = previous;
      this.media.outputFolder = previousFolder;
      throw error;
    } finally {
      this.preparing = false;
    }
  }
  private async validateFolder(): Promise<void> {
    const state = this.state;
    if (!state) return;
    state.folderError = null;
    state.freeBytes = null;
    await this.planNames(null);
    try {
      if (!state.folder) throw new Error('Choose an output folder.');
      const folder = state.folder;
      if (!(await stat(folder)).isDirectory())
        throw new Error('Output destination is not a folder.');
      const checkPath = join(
        folder,
        `.video-text-editor-check-${randomUUID()}`,
      );
      const file = await open(checkPath, 'wx', 0o600);
      const linkPath = `${checkPath}.link`;
      let linked = false;
      try {
        try {
          await file.writeFile('1');
          await file.sync();
        } finally {
          await file.close();
        }
        try {
          await link(checkPath, linkPath);
          linked = true;
        } catch (error) {
          throw new Error(
            `The output folder must support hard links for safe, no-overwrite publication. Choose another local folder. ${message(error)}`,
            { cause: error },
          );
        }
      } finally {
        try {
          if (linked) await rm(linkPath);
        } finally {
          await rm(checkPath);
        }
      }
      const space = await statfs(folder);
      state.freeBytes = space.bavail * space.bsize;
      if (state.freeBytes <= 0)
        throw new Error('Insufficient free space in the output folder.');
      await this.planNames(folder);
    } catch (error) {
      state.folderError = `Output folder unavailable: ${message(error)}`;
    }
  }
  private async planNames(folder: string | null): Promise<void> {
    if (!this.state) return;
    const reserved = new Set<string>();
    for (const job of this.state.jobs) {
      if (job.status !== 'ready') continue;
      let suffix = 1;
      for (;;) {
        const filename = `${parse(job.name).name}_edited${suffix === 1 ? '' : `_${suffix}`}.mp4`;
        let exists = reserved.has(filename.toLocaleLowerCase('en-US'));
        if (!exists && folder) {
          try {
            await stat(join(folder, filename));
            exists = true;
          } catch (error) {
            if (
              error instanceof Error &&
              'code' in error &&
              error.code === 'ENAMETOOLONG'
            ) {
              job.status = 'blocked';
              job.error =
                'Output filename is too long. Rename the original and locate it again, preserving its saved text.';
              break;
            }
            if (!missing(error)) throw error;
          }
        }
        if (!exists) {
          job.filename = filename;
          job.suffix = suffix;
          reserved.add(filename.toLocaleLowerCase('en-US'));
          break;
        }
        suffix++;
      }
    }
  }
  async start(id: string): Promise<void> {
    const state = this.state;
    if (
      !state ||
      this.closing ||
      state.id !== id ||
      state.status !== 'preflight' ||
      this.isRunning() ||
      this.preparing
    )
      throw new Error('This export preflight is no longer current.');
    if (
      !state.folder ||
      state.folderError ||
      !state.jobs.some((job) => job.status === 'ready')
    )
      throw new Error('Choose a valid folder and at least one eligible video.');
    if (this.media.isBusy())
      throw new Error('Wait for the current media operation.');
    this.stopped = false;
    state.status = 'running';
    for (const job of state.jobs)
      if (job.status === 'ready') job.status = 'queued';
    const settled = Promise.withResolvers<void>();
    this.done = settled.promise;
    try {
      await this.save();
    } catch (error) {
      state.status = 'preflight';
      for (const job of state.jobs)
        if (job.status === 'queued') job.status = 'ready';
      this.done = null;
      settled.resolve();
      throw error;
    }
    void this.run(state)
      .catch((error: unknown) => {
        console.error('Export queue tracking failed.', error);
        state.notice = `Export tracking failed: ${message(error)}. No further jobs were started. Inspect the output folder before retrying.`;
        for (const job of state.jobs)
          if (job.status === 'queued' || job.status === 'exporting') {
            job.status = 'failed';
            job.error = state.notice;
          }
        state.status = 'finished';
      })
      .finally(() => {
        this.done = null;
        settled.resolve();
      });
  }
  private async run(state: ExportQueue): Promise<void> {
    const folder = state.folder;
    if (!folder) throw new Error('Output folder missing.');
    for (const job of state.jobs) {
      if (job.status !== 'queued') continue;
      if (this.stopped) {
        job.status = 'cancelled';
        continue;
      }
      job.status = 'exporting';
      const directory = join(folder, `.video-text-editor-${randomUUID()}`);
      job.temporaryPath = directory;
      await this.save();
      if (this.stopped) {
        job.status = 'cancelled';
        job.temporaryPath = null;
        continue;
      }
      try {
        if (!job.textBox) throw new Error('Frozen export text missing.');
        const result = await this.render(
          { assetId: job.assetId, textBox: job.textBox },
          { destination: folder, suffix: job.suffix, directory },
        );
        if (!result.ok) throw new Error(result.error);
        if (result.outcome === 'completed') {
          job.status = 'completed';
          job.path = result.path;
          job.error = result.warning ?? null;
          if (!result.warning) job.temporaryPath = null;
        } else {
          job.status = 'cancelled';
          job.temporaryPath = null;
        }
      } catch (error) {
        console.error(`Export failed: ${job.name}`, error);
        job.status = 'failed';
        job.error = message(error);
        try {
          await stat(directory);
        } catch (cleanupError) {
          if (missing(cleanupError)) job.temporaryPath = null;
          else
            job.error += ` Cleanup could not be verified at ${job.temporaryPath}: ${message(cleanupError)}`;
        }
      }
      await this.save();
    }
    const finished: ExportQueue = {
      ...state,
      status: 'finished',
      phase: 'idle',
      fraction: 0,
    };
    await this.save(finished);
    Object.assign(state, finished);
  }
  cancel(): void {
    if (!this.isRunning()) return;
    this.stopped = true;
    if (this.state) this.state.status = 'stopping';
    this.media.cancel();
  }
  dismiss(): void {
    if (this.state?.status === 'preflight' && !this.preparing)
      this.state = this.lastResults;
  }
}
