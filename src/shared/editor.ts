import { z } from 'zod';

export const TextBoxSchema = z.strictObject({
  text: z.string(),
  font: z.enum(['sans', 'serif']),
  fontSize: z.number().finite().min(1),
  bold: z.boolean(),
  italic: z.boolean(),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i),
  align: z.enum(['left', 'center', 'right']),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  padding: z.number().finite().nonnegative(),
});
export type TextBox = z.infer<typeof TextBoxSchema>;

export const VideoColourSchema = z.discriminatedUnion('dynamicRange', [
  z.strictObject({
    dynamicRange: z.literal('sdr'),
    bitDepth: z.union([z.literal(8), z.literal(10)]),
  }),
  z.strictObject({
    dynamicRange: z.enum(['hlg', 'pq']),
    range: z.enum(['limited', 'full']),
    dolbyVision: z.boolean(),
  }),
]);
export type VideoColour = z.infer<typeof VideoColourSchema>;

export const VideoAssetSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().finite().positive(),
  rotation: z.number(),
  sampleAspectRatio: z.number().finite().positive(),
  audioChannels: z.array(z.number().int().positive()),
  colour: VideoColourSchema,
});
export type VideoAsset = z.infer<typeof VideoAssetSchema>;

export const ExportRequestSchema = z.strictObject({
  assetId: z.uuid(),
  textBox: TextBoxSchema,
});
export const ExportProgressSchema = z.strictObject({
  phase: z.enum([
    'idle',
    'choosing',
    'rendering',
    'encoding',
    'validating',
    'stopping',
  ]),
  fraction: z.number().min(0).max(1),
});
export type ExportProgress = z.infer<typeof ExportProgressSchema>;
export const ImportResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), asset: VideoAssetSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export const ExportResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    outcome: z.literal('completed'),
    id: z.uuid(),
    path: z.string(),
    warning: z.string().optional(),
  }),
  z.strictObject({ ok: z.literal(true), outcome: z.literal('cancelled') }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export const ActionResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), warning: z.string().optional() }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type ImportResult = z.infer<typeof ImportResultSchema>;
export type ExportResult = z.infer<typeof ExportResultSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export const ProgressResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), progress: ExportProgressSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type ProgressResult = z.infer<typeof ProgressResultSchema>;

export const EDITOR_CHANNELS = {
  import: 'editor:import',
  export: 'editor:export',
  progress: 'editor:progress',
  cancel: 'editor:cancel',
  reveal: 'editor:reveal',
  overlayRequest: 'overlay:request',
  overlayReady: 'overlay:ready',
} as const;

export const OverlayRequestSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  textBox: TextBoxSchema,
});
export const OverlayReadySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), minimumHeight: z.number().positive() }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type OverlayRequest = z.infer<typeof OverlayRequestSchema>;
export type OverlayReady = z.infer<typeof OverlayReadySchema>;

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeHandle = (typeof HANDLES)[number];

export function newTextBox(
  video: Pick<VideoAsset, 'width' | 'height'>,
  x: number,
  y: number,
): TextBox {
  const fontSize = Math.max(1, Math.round((48 * video.height) / 1080));
  const padding = (8 * video.height) / 1080;
  return {
    text: '',
    font: 'sans',
    fontSize,
    bold: false,
    italic: false,
    colour: '#FFFFFF',
    align: 'left',
    x,
    y,
    width: video.width * 0.6,
    height: Math.ceil(fontSize * 1.2 + padding * 2),
    padding,
  };
}

export function resizeTextBox(
  box: TextBox,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  fit: (box: TextBox) => { width: number; height: number },
): TextBox {
  const next = { ...box };
  if (handle.includes('e')) next.width += dx;
  if (handle.includes('w')) next.width -= dx;
  if (handle.includes('s')) next.height += dy;
  if (handle.includes('n')) next.height -= dy;
  const minimum = fit({
    ...next,
    width: Math.max(next.width, box.padding * 2 + 1),
  });
  next.width = Math.max(next.width, minimum.width);
  const heightMinimum = fit(next).height;
  next.height = Math.max(next.height, heightMinimum);
  if (handle.includes('w')) next.x = box.x + box.width - next.width;
  if (handle.includes('n')) next.y = box.y + box.height - next.height;
  return next;
}

export function unsupportedText(text: string): string[] {
  const allowed =
    /^(?:[\x20-\x7e]|\p{Script=Latin}|\p{Mark}|\p{Number}|\p{Punctuation}|\p{White_Space}|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200d|\ufe0e|\ufe0f)$/u;
  return [
    ...new Set(
      Array.from(text).filter((character) => !allowed.test(character)),
    ),
  ];
}
