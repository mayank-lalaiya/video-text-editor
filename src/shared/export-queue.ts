import { z } from 'zod';
import { TextBoxSchema } from './editor.ts';

export const ExportScopeSchema = z.enum(['current', 'checked', 'all', 'retry']);
export type ExportScope = z.infer<typeof ExportScopeSchema>;
export const ExportJobSchema = z.strictObject({
  assetId: z.uuid(),
  name: z.string(),
  format: z.string(),
  filename: z.string(),
  suffix: z.number().int().positive(),
  textBox: TextBoxSchema.nullable(),
  status: z.enum([
    'ready',
    'skipped',
    'blocked',
    'queued',
    'exporting',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  error: z.string().nullable(),
  path: z.string().nullable(),
  temporaryPath: z.string().nullable(),
});
export type ExportJob = z.infer<typeof ExportJobSchema>;
export const ExportQueueSchema = z.strictObject({
  id: z.uuid(),
  scope: ExportScopeSchema,
  status: z.enum([
    'preflight',
    'running',
    'stopping',
    'finished',
    'interrupted',
  ]),
  folder: z.string().nullable(),
  folderError: z.string().nullable(),
  freeBytes: z.number().finite().nonnegative().nullable(),
  jobs: z.array(ExportJobSchema),
  phase: z.string(),
  fraction: z.number().min(0).max(1),
  notice: z.string().nullable(),
});
export type ExportQueue = z.infer<typeof ExportQueueSchema>;
export const QueueCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('prepare'), scope: ExportScopeSchema }),
  z.strictObject({ type: z.literal('start'), id: z.uuid() }),
  z.strictObject({ type: z.literal('folder') }),
  z.strictObject({ type: z.literal('status') }),
  z.strictObject({ type: z.literal('cancel') }),
  z.strictObject({ type: z.literal('show-folder') }),
  z.strictObject({ type: z.literal('dismiss') }),
]);
export type QueueCommand = z.infer<typeof QueueCommandSchema>;
export const QueueResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), state: ExportQueueSchema.nullable() }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type QueueResult = z.infer<typeof QueueResultSchema>;
export const QUEUE_CHANNEL = 'editor:export-queue';
export const queueRunning = (state: ExportQueue | null) =>
  state?.status === 'running' || state?.status === 'stopping';
