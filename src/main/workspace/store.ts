import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { WorkspaceSchema } from '../../shared/workspace.ts';

export const SourceReferenceSchema = z.strictObject({
  path: z.string().min(1),
  identity: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export const SavedWorkspaceSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2)]),
    workspace: WorkspaceSchema,
    sources: z.record(z.uuid(), SourceReferenceSchema),
    outputFolder: z.string().nullable(),
  })
  .superRefine((value, context) => {
    for (const entry of value.workspace.entries)
      if (!value.sources[entry.asset.id])
        context.addIssue({
          code: 'custom',
          message: 'A workspace source reference is missing.',
        });
  })
  .transform((value) => ({ ...value, version: 2 as const }));
export type SavedWorkspace = z.infer<typeof SavedWorkspaceSchema>;

export class WorkspaceStore {
  private readonly path: string;
  private writes: Promise<void> = Promise.resolve();
  private blocked = false;
  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<{
    data: SavedWorkspace | null;
    warning: string | null;
  }> {
    let bytes: string;
    try {
      bytes = await readFile(this.path, 'utf8');
    } catch (error) {
      this.blocked = true;
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        try {
          await access(`${this.path}.backup`);
        } catch (backupError) {
          if (
            backupError instanceof Error &&
            'code' in backupError &&
            backupError.code === 'ENOENT'
          ) {
            this.blocked = false;
            return { data: null, warning: null };
          }
          throw backupError;
        }
        throw new Error(
          'Workspace file is missing, but a previous save exists. Recover the previous save or explicitly archive and reset the workspace.',
        );
      }
      throw error;
    }
    try {
      const data = SavedWorkspaceSchema.parse(JSON.parse(bytes));
      this.blocked = false;
      return { data, warning: null };
    } catch (error) {
      console.error(
        'Workspace restoration failed; preserving the damaged file.',
        error,
      );
      this.blocked = true;
      throw new Error(
        'Workspace could not be restored. Retry restoration or explicitly recover the previous save; the original file has not been overwritten.',
        { cause: error },
      );
    }
  }
  recover(): Promise<void> {
    return this.enqueue(async () => {
      this.blocked = true;
      const bytes = await readFile(`${this.path}.backup`, 'utf8');
      const backup = SavedWorkspaceSchema.parse(JSON.parse(bytes));
      await this.write(backup, true);
      this.blocked = false;
    });
  }
  save(value: SavedWorkspace): Promise<void> {
    const snapshot = SavedWorkspaceSchema.parse(value);
    return this.enqueue(() => this.write(snapshot));
  }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.writes = this.writes
      .catch((error: unknown) => {
        console.error('Retrying after a failed workspace write.', error);
      })
      .then(operation);
    return this.writes;
  }
  private async write(snapshot: SavedWorkspace, recovering = false) {
    if (this.blocked && !recovering)
      throw new Error(
        'Restoration failed. Recover the previous save before overwriting this workspace.',
      );
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.pending`;
    try {
      const handle = await open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(JSON.stringify(snapshot));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await copyFile(
          this.path,
          recovering
            ? `${this.path}.damaged-${Date.now()}`
            : `${this.path}.backup`,
        );
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        )
          throw error;
      }
      await rename(temporary, this.path);
      const directory = await open(dirname(this.path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async reset(): Promise<void> {
    try {
      await rename(this.path, `${this.path}.archived-${Date.now()}`);
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    this.blocked = false;
  }
}
