import { z } from 'zod';
import { TextBoxSchema, type TextBox, type VideoAsset } from './editor.ts';
import type { TextState } from './history.ts';
import type { Workspace } from './workspace.ts';

export const TextDefaultSchema = z.strictObject({
  sourceName: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sampleAspectRatio: z.number().finite().positive(),
  box: TextBoxSchema.refine(
    (box) => !!box.text.trim(),
    'Default text is empty.',
  ),
  enabled: z.boolean(),
});
export type TextDefault = z.infer<typeof TextDefaultSchema>;
export type MeasureText = (box: TextBox) => { width: number; height: number };
export interface CopyReport {
  sourceName: string;
  filled: number;
  preserved: number;
  mixed: number;
  errors: { name: string; error: string }[];
  undone: boolean;
  undoLimited: boolean;
}
export interface CopyPlan {
  sourceId: string;
  textDefault: TextDefault;
  copies: { id: string; text: TextState }[];
  report: CopyReport;
}
export function mixedTextRatio(
  snapshot: TextDefault,
  video: VideoAsset,
): boolean {
  const sourceRatio =
    (snapshot.width * snapshot.sampleAspectRatio) / snapshot.height;
  const targetRatio = (video.width * video.sampleAspectRatio) / video.height;
  const sourcePixelRatio = snapshot.width / snapshot.height;
  const targetPixelRatio = video.width / video.height;
  return (
    Math.abs(sourceRatio - targetRatio) >
      0.000001 * Math.max(sourceRatio, targetRatio) ||
    Math.abs(sourcePixelRatio - targetPixelRatio) >
      0.000001 * Math.max(sourcePixelRatio, targetPixelRatio)
  );
}
export function copyText(
  snapshot: TextDefault,
  video: VideoAsset,
  measure: MeasureText,
): TextState {
  const sx = video.width / snapshot.width;
  const sy = video.height / snapshot.height;
  const box = TextBoxSchema.parse({
    ...snapshot.box,
    x: snapshot.box.x * sx,
    y: snapshot.box.y * sy,
    width: snapshot.box.width * sx,
    height: snapshot.box.height * sy,
    fontSize: snapshot.box.fontSize * sy,
    padding: snapshot.box.padding * sy,
  });
  const minimum = measure(box);
  if (
    !Number.isFinite(minimum.width) ||
    minimum.width <= 0 ||
    !Number.isFinite(minimum.height) ||
    minimum.height <= 0
  )
    throw new Error('Text measurement did not produce valid dimensions.');
  return {
    box: TextBoxSchema.parse({
      ...box,
      width: Math.max(box.width, minimum.width),
      height: Math.max(box.height, minimum.height),
    }),
    minimumHeight: minimum.height,
  };
}
export function createCopyPlan(
  workspace: Workspace,
  measure: MeasureText,
): CopyPlan {
  const source = workspace.entries.find(
    (entry) => entry.asset.id === workspace.activeId,
  );
  if (!source?.text?.box.text.trim())
    throw new Error(
      'Add non-empty text to the active video before applying it.',
    );
  const textDefault = TextDefaultSchema.parse({
    sourceName: source.asset.name,
    width: source.asset.width,
    height: source.asset.height,
    sampleAspectRatio: source.asset.sampleAspectRatio,
    box: { ...source.text.box },
    enabled: workspace.textDefault?.enabled ?? true,
  });
  copyText(textDefault, source.asset, measure);
  const plan: CopyPlan = {
    sourceId: source.asset.id,
    textDefault,
    copies: [],
    report: {
      sourceName: source.asset.name,
      filled: 0,
      preserved: 0,
      mixed: 0,
      errors: [],
      undone: false,
      undoLimited: false,
    },
  };
  for (const entry of workspace.entries) {
    if (entry === source) continue;
    if (entry.text?.box.text.trim()) {
      plan.report.preserved++;
      continue;
    }
    try {
      const text = copyText(textDefault, entry.asset, measure);
      plan.copies.push({ id: entry.asset.id, text });
      plan.report.filled++;
      if (mixedTextRatio(textDefault, entry.asset)) plan.report.mixed++;
    } catch (error) {
      plan.report.errors.push({
        name: entry.asset.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return plan;
}
