import { z } from 'zod';
import { TextBoxSchema, VideoAssetSchema } from './editor.ts';
import { TextDefaultSchema } from './text-copy.ts';

export const TextStateSchema = z.strictObject({
  box: TextBoxSchema,
  minimumHeight: z.number().finite().positive(),
});
export const WorkspaceEntrySchema = z.strictObject({
  asset: VideoAssetSchema,
  text: TextStateSchema.nullable(),
  checked: z.boolean(),
  time: z.number().finite().nonnegative(),
  issue: z.string().optional(),
});
export const WorkspaceSchema = z
  .strictObject({
    entries: z.array(WorkspaceEntrySchema),
    activeId: z.uuid().nullable(),
    textDefault: TextDefaultSchema.nullable().default(null),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.entries.map((entry) => entry.asset.id));
    if (
      ids.size !== value.entries.length ||
      (value.activeId !== null && !ids.has(value.activeId))
    )
      context.addIssue({
        code: 'custom',
        message:
          'Workspace IDs must be unique and the active video must exist.',
      });
    for (const entry of value.entries)
      if (entry.time > entry.asset.duration)
        context.addIssue({
          code: 'custom',
          message: 'A saved playhead exceeds its video duration.',
        });
  });
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
export function emptyWorkspace(): Workspace {
  return { entries: [], activeId: null, textDefault: null };
}
export const WorkspaceResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    workspace: WorkspaceSchema,
    warning: z.string().nullable(),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type WorkspaceResult = z.infer<typeof WorkspaceResultSchema>;
export const WORKSPACE_CHANNELS = {
  load: 'workspace:load',
  save: 'workspace:save',
  remove: 'workspace:remove',
  clear: 'workspace:clear',
  relink: 'workspace:relink',
  recover: 'workspace:recover',
  reset: 'workspace:reset',
  flush: 'workspace:flush-request',
  flushed: 'workspace:flushed',
} as const;
