import { z } from 'zod';
import type { QueueCommand, QueueResult } from './export-queue.ts';
import type { Workspace, WorkspaceResult } from './workspace.ts';
import type { PreviewRequest, PreviewResult } from './preview.ts';
import type { HistoryCommand, HistoryMenuState } from './history.ts';
import type {
  ImportResult,
  ExportRequest,
  ExportResult,
  ProgressResult,
  ActionResult,
} from './editor.ts';

export const BOOTSTRAP_CHANNEL = 'desktop:get-bootstrap';

export const ResourceKindSchema = z.enum(['font', 'tool', 'license', 'source']);
export const ResourceCheckSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  kind: ResourceKindSchema,
  status: z.enum(['ready', 'error']),
  detail: z.string(),
});
export const BootstrapResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: z.strictObject({
      appVersion: z.string(),
      platform: z.string(),
      architecture: z.string(),
      checks: z.array(ResourceCheckSchema),
    }),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);

export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export type ResourceCheck = z.infer<typeof ResourceCheckSchema>;
export type BootstrapResult = z.infer<typeof BootstrapResultSchema>;
export type BootstrapData = Extract<BootstrapResult, { ok: true }>['data'];

export interface DesktopApi {
  exportQueue(command: QueueCommand): Promise<QueueResult>;
  getBootstrap(): Promise<BootstrapResult>;
  importVideo(file: File): Promise<ImportResult>;
  loadWorkspace(): Promise<WorkspaceResult>;
  saveWorkspace(workspace: Workspace): Promise<ActionResult>;
  removeVideo(id: string): Promise<ActionResult>;
  clearWorkspace(): Promise<ActionResult>;
  relinkVideo(id: string, file: File): Promise<ImportResult>;
  recoverWorkspace(): Promise<WorkspaceResult>;
  resetWorkspace(): Promise<WorkspaceResult>;
  onWorkspaceFlush(
    callback: () => Promise<void>,
    onCancelled: () => void,
  ): () => void;
  exportVideo(request: ExportRequest): Promise<ExportResult>;
  getExportProgress(): Promise<ProgressResult>;
  cancelExport(): Promise<ActionResult>;
  revealExport(id: string): Promise<ActionResult>;
  startPreview(request: PreviewRequest): Promise<PreviewResult>;
  stopPreview(id: string): Promise<ActionResult>;
  setHistoryMenuState(state: HistoryMenuState): Promise<ActionResult>;
  onHistoryCommand(callback: (command: HistoryCommand) => void): () => void;
}
