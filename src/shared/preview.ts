import { z } from 'zod';

export const PREVIEW_WINDOW_SECONDS = 8;
export const PREVIEW_CHANNELS = {
  start: 'preview:start',
  stop: 'preview:stop',
} as const;
export const PreviewRequestSchema = z.strictObject({
  assetId: z.uuid(),
  start: z.number().finite().nonnegative(),
});
export const PreviewResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    outcome: z.literal('started'),
    session: z.strictObject({
      id: z.uuid(),
      url: z.string().regex(/^app-media:\/\/preview\/[0-9a-f-]{36}$/),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().positive(),
      mime: z.enum([
        'video/mp4; codecs="avc1.42E01F"',
        'video/mp4; codecs="avc1.42E01F, mp4a.40.2"',
      ]),
    }),
  }),
  z.strictObject({ ok: z.literal(true), outcome: z.literal('cancelled') }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
export type PreviewResult = z.infer<typeof PreviewResultSchema>;
