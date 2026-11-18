import { realpath } from 'node:fs/promises';
import type { MediaService } from '../media/service.ts';
import { emptyWorkspace, type Workspace } from '../../shared/workspace.ts';
import { WorkspaceStore, type SourceReference } from './store.ts';

type WorkspaceMedia = Pick<
  MediaService,
  | 'outputFolder'
  | 'onOutputFolderChanged'
  | 'importVideo'
  | 'reference'
  | 'isBusy'
  | 'removeSource'
>;

class RestorationInterrupted extends Error {}

export class WorkspaceService {
  private readonly store: WorkspaceStore;
  private readonly media: WorkspaceMedia;
  private sources = new Map<string, SourceReference>();
  private document: Workspace = emptyWorkspace();
  private loading:
    | Promise<{ workspace: Workspace; warning: string | null }>
    | undefined;
  private restoringStopped = false;
  constructor(path: string, media: WorkspaceMedia) {
    this.store = new WorkspaceStore(path);
    this.media = media;
    media.onOutputFolderChanged = () => this.flush();
  }
  async load() {
    if (this.restoringStopped && this.loading) {
      try {
        await this.loading;
      } catch (error) {
        if (!(error instanceof RestorationInterrupted)) throw error;
        console.info(
          'Retrying workspace restoration after closing the editor.',
        );
      }
    }
    this.loading ??= this.restore().catch((error: unknown) => {
      this.loading = undefined;
      throw error;
    });
    await this.loading;
    return { workspace: this.document, warning: null };
  }
  private checkRestoring() {
    if (this.restoringStopped)
      throw new RestorationInterrupted(
        'Workspace restoration was interrupted by closing the editor. Reopen to restore it.',
      );
  }
  private async restore() {
    this.restoringStopped = false;
    const saved = await this.store.load();
    if (saved.data) {
      this.document = saved.data.workspace;
      this.sources = new Map(Object.entries(saved.data.sources));
      this.media.outputFolder = saved.data.outputFolder;
      for (const entry of this.document.entries) {
        this.checkRestoring();
        const reference = this.sources.get(entry.asset.id);
        if (!reference) throw new Error('Source reference missing.');
        try {
          const asset = await this.media.importVideo(reference.path, {
            id: entry.asset.id,
            reference,
          });
          entry.asset = asset;
          delete entry.issue;
        } catch (error) {
          this.checkRestoring();
          console.error('Workspace source unavailable.', error);
          entry.issue = `Source unavailable: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      this.checkRestoring();
    }
    return { workspace: this.document, warning: saved.warning };
  }
  async importVideo(path: string) {
    const canonical = await realpath(path);
    if ([...this.sources.values()].some((source) => source.path === canonical))
      throw new Error(
        'Already imported. Existing text and selections were kept.',
      );
    const asset = await this.media.importVideo(path);
    this.sources.set(asset.id, this.media.reference(asset.id));
    return asset;
  }
  async save(workspace: Workspace): Promise<void> {
    const sources: Record<string, SourceReference> = {};
    for (const entry of workspace.entries) {
      const source = this.sources.get(entry.asset.id);
      if (!source) throw new Error('Cannot save an unknown workspace source.');
      sources[entry.asset.id] = source;
    }
    await this.store.save({
      version: 2,
      workspace,
      sources,
      outputFolder: this.media.outputFolder,
    });
    this.document = workspace;
  }
  async relink(id: string, path: string) {
    const reference = this.sources.get(id);
    if (!reference) throw new Error('Unknown source.');
    const asset = await this.media.importVideo(path, {
      id,
      reference,
      relink: true,
    });
    this.sources.set(id, this.media.reference(id));
    return asset;
  }
  async remove(id: string) {
    if (this.media.isBusy())
      throw new Error('Wait for the current media operation.');
    const index = this.document.entries.findIndex(
      (entry) => entry.asset.id === id,
    );
    if (index < 0) throw new Error('Video no longer exists in the workspace.');
    const entries = this.document.entries.filter(
      (entry) => entry.asset.id !== id,
    );
    await this.save({
      ...this.document,
      entries,
      activeId:
        this.document.activeId === id
          ? (entries[Math.min(index, entries.length - 1)]?.asset.id ?? null)
          : this.document.activeId,
    });
    return this.removeSources([id]);
  }
  async clear() {
    if (this.media.isBusy())
      throw new Error('Wait for the current media operation.');
    await this.save(emptyWorkspace());
    return this.removeSources([...this.sources.keys()]);
  }
  private async removeSources(ids: string[]): Promise<string | undefined> {
    const warnings: string[] = [];
    for (const id of ids) {
      try {
        await this.media.removeSource(id);
      } catch (error) {
        console.error('Workspace media cleanup failed after saving.', error);
        warnings.push(
          `Cached media cleanup failed for ${this.sources.get(id)?.path ?? id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.sources.delete(id);
    }
    return warnings.length
      ? `Workspace change saved; original media is unchanged. ${warnings.join('\n')}`
      : undefined;
  }
  async recover() {
    await this.store.recover();
    this.loading = undefined;
    return this.load();
  }
  async reset() {
    await this.store.reset();
    const warning = await this.removeSources([...this.sources.keys()]);
    this.document = emptyWorkspace();
    await this.save(this.document);
    this.loading = undefined;
    return { ...(await this.load()), warning: warning ?? null };
  }
  async flush() {
    await this.save(this.document);
  }
  snapshot(): Workspace {
    return structuredClone(this.document);
  }
  pauseRestore() {
    this.restoringStopped = true;
  }
}
