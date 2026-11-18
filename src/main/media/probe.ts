import { z } from 'zod';
import type { VideoAsset, VideoColour } from '../../shared/editor.ts';
import type { MediaWorker } from './worker.ts';
import { exportCodec } from './colour.ts';

const StreamSchema = z.object({
  index: z.number(),
  codec_type: z.string(),
  codec_name: z.string().optional(),
  codec_tag_string: z.string().optional(),
  profile: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.string().optional(),
  bit_rate: z.string().optional(),
  start_time: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  sample_aspect_ratio: z.string().optional(),
  nb_frames: z.string().optional(),
  nb_read_frames: z.string().optional(),
  channels: z.number().optional(),
  channel_layout: z.string().optional(),
  pix_fmt: z.string().optional(),
  color_transfer: z.string().optional(),
  color_primaries: z.string().optional(),
  color_space: z.string().optional(),
  color_range: z.string().optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).optional(),
  side_data_list: z
    .array(
      z.object({
        rotation: z.number().optional(),
        side_data_type: z.string().optional(),
        dv_profile: z.number().optional(),
        dv_bl_signal_compatibility_id: z.number().optional(),
        bl_present_flag: z.number().optional(),
        el_present_flag: z.number().optional(),
      }),
    )
    .optional(),
});
const ProbeSchema = z.object({
  streams: z.array(StreamSchema),
  format: z.object({ duration: z.string().optional() }),
});
export type Probe = z.infer<typeof ProbeSchema>;
const staleHdrMetadata =
  /dovi|dolby|dynamic hdr|hdr dynamic|mastering display|content light/i;
const HdrFramesSchema = z.object({
  frames: z
    .array(
      z.object({
        side_data_list: z
          .array(z.object({ side_data_type: z.string() }))
          .optional(),
      }),
    )
    .min(1),
});

export async function validateHdrFrames(
  worker: Pick<MediaWorker, 'run'>,
  ffprobe: string,
  file: string,
  signal: AbortSignal,
): Promise<void> {
  const json = await worker.run(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame_side_data=side_data_type',
      '-of',
      'json=compact=1',
      file,
    ],
    signal,
  );
  const value: unknown = JSON.parse(json);
  const { frames } = HdrFramesSchema.parse(value);
  if (
    frames.some((frame) =>
      frame.side_data_list?.some((side) =>
        staleHdrMetadata.test(side.side_data_type),
      ),
    )
  )
    throw new Error(
      'Output HDR validation failed: stale or Dolby Vision metadata remains in encoded frames. No output was published.',
    );
}

export function ratio(value: string | undefined, separator = '/'): number {
  if (!value || value === 'N/A' || value === '0:1' || value === '0/0') return 1;
  const [numerator, denominator] = value.split(separator).map(Number);
  if (
    !numerator ||
    numerator < 0 ||
    !denominator ||
    denominator < 0 ||
    !Number.isFinite(numerator / denominator)
  )
    throw new Error(`Invalid video ratio: ${value}.`);
  return numerator / denominator;
}

function timestamp(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed))
    throw new Error(
      `Missing or invalid ${label}. Reimport a video with usable timing metadata.`,
    );
  return parsed;
}

export async function probeVideo(
  worker: MediaWorker,
  ffprobe: string,
  file: string,
  signal: AbortSignal,
  { countFrames = false }: { countFrames?: boolean } = {},
): Promise<Probe> {
  const json = await worker.run(
    ffprobe,
    [
      '-v',
      'error',
      ...(countFrames ? ['-count_frames'] : []),
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ],
    signal,
  );
  const value: unknown = JSON.parse(json);
  return ProbeSchema.parse(value);
}

export function videoStream(probe: Probe) {
  const video = probe.streams.find(
    (stream) =>
      stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  );
  if (!video?.width || !video.height)
    throw new Error(
      'No decodable video stream with valid dimensions was found.',
    );
  return { ...video, width: video.width, height: video.height };
}

export async function sourceVideoBitrate(
  worker: Pick<MediaWorker, 'run'>,
  ffprobe: string,
  file: string,
  probe: Probe,
  signal: AbortSignal,
): Promise<number> {
  const video = videoStream(probe);
  const reported = Number(video.bit_rate);
  if (Number.isFinite(reported) && reported > 0) return reported;
  console.info(
    'Video bitrate metadata unavailable; measuring encoded video packets.',
  );
  const sizes = await worker.run(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      String(video.index),
      '-show_entries',
      'packet=size:packet_side_data=',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ],
    signal,
  );
  let bytes = 0;
  for (const size of sizes.trim().split(/\r?\n/)) {
    if (!/^\d+$/.test(size))
      throw new Error(
        'Source video packet sizes could not be verified for bitrate control.',
      );
    bytes += Number(size);
  }
  const duration =
    Number(video.duration) > 0
      ? Number(video.duration)
      : Number(probe.format.duration);
  const bitrate = (bytes * 8) / duration;
  if (!Number.isSafeInteger(bytes) || !Number.isFinite(bitrate) || bitrate <= 0)
    throw new Error('Source video bitrate could not be determined safely.');
  return bitrate;
}

function frameCount(value: string | undefined): number | undefined {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

export function reportedFrameCountsMatch(
  source: Probe,
  output: Probe,
): boolean {
  const original = frameCount(videoStream(source).nb_frames);
  return (
    original !== undefined &&
    original === frameCount(videoStream(output).nb_frames)
  );
}

function describeColour(video: ReturnType<typeof videoStream>): VideoColour {
  const dolby = video.side_data_list?.find((item) =>
    /dovi|dolby/i.test(item.side_data_type ?? ''),
  );
  const transfer = video.color_transfer;
  if (dolby) {
    const compatible =
      (transfer === 'arib-std-b67' &&
        dolby.dv_bl_signal_compatibility_id === 4) ||
      (transfer === 'smpte2084' && dolby.dv_bl_signal_compatibility_id === 1);
    if (
      dolby.dv_profile !== 8 ||
      dolby.bl_present_flag !== 1 ||
      dolby.el_present_flag !== 0 ||
      !compatible
    )
      throw new Error(
        'This Dolby Vision variant has no supported standalone HLG/PQ base layer. Use profile 8 with an HLG/HDR10-compatible base.',
      );
  }
  if (transfer === 'arib-std-b67' || transfer === 'smpte2084') {
    if (
      video.color_primaries !== 'bt2020' ||
      video.color_space !== 'bt2020nc' ||
      !['tv', 'pc'].includes(video.color_range ?? '') ||
      !/10/.test(video.pix_fmt ?? '')
    )
      throw new Error(
        'HDR input needs tagged BT.2020 non-constant-luminance colour, a known full/limited range and supported 10-bit pixels.',
      );
    return {
      dynamicRange: transfer === 'arib-std-b67' ? 'hlg' : 'pq',
      range: video.color_range === 'tv' ? 'limited' : 'full',
      dolbyVision: !!dolby,
    };
  }
  if (
    video.side_data_list?.some((item) =>
      /mastering display|content light|dynamic hdr/i.test(
        item.side_data_type ?? '',
      ),
    ) ||
    (/10|12/.test(video.pix_fmt ?? '') && (!transfer || transfer === 'unknown'))
  ) {
    throw new Error(
      'Ambiguous HDR or untagged high-bit-depth input cannot be processed safely. Use a source with explicit SDR, HLG or PQ colour metadata.',
    );
  }
  if (
    video.pix_fmt &&
    !['yuv420p', 'yuvj420p', 'nv12', 'yuv420p10le', 'p010le'].includes(
      video.pix_fmt,
    )
  )
    throw new Error(
      'This export preserves supported 8/10-bit 4:2:0 SDR sources. Other bit depths or chroma formats are not silently reduced.',
    );
  return {
    dynamicRange: 'sdr',
    bitDepth: /10/.test(video.pix_fmt ?? '') ? 10 : 8,
  };
}

export function describeVideo(
  probe: Probe,
  id: string,
  name: string,
): VideoAsset {
  const video = videoStream(probe);
  if (video.codec_name !== 'h264' && video.codec_name !== 'hevc')
    throw new Error('Choose an H.264 or HEVC MP4/MOV for this proof.');
  const colour = describeColour(video);
  if (probe.streams.some((stream) => stream.codec_name === 'apple_apac'))
    throw new Error(
      'This video includes Apple APAC spatial audio, which this build cannot decode. No audio tracks have been dropped. Use a copy with supported AAC audio.',
    );
  const rotation =
    video.side_data_list?.find((item) => item.rotation !== undefined)
      ?.rotation ?? 0;
  if (Math.abs(rotation / 90 - Math.round(rotation / 90)) > 0.0001)
    throw new Error(
      'This proof needs a standard 0/90/180/270-degree video orientation.',
    );
  const swapped = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const duration = Number(probe.format.duration ?? video.duration);
  if (!(duration > 0) || !Number.isFinite(duration))
    throw new Error('The video duration could not be determined.');
  const sar = ratio(video.sample_aspect_ratio, ':');
  if (
    !video.avg_frame_rate ||
    video.avg_frame_rate === 'N/A' ||
    video.avg_frame_rate === '0/0'
  )
    throw new Error('Frame timing could not be determined for this proof.');
  ratio(video.avg_frame_rate);
  timestamp(video.start_time, 'video start time');
  for (const stream of probe.streams.filter(
    (item) => item.codec_type === 'audio',
  ))
    timestamp(stream.start_time, 'audio start time');
  return {
    id,
    name,
    colour,
    width: swapped ? video.height : video.width,
    height: swapped ? video.width : video.height,
    duration,
    rotation,
    sampleAspectRatio: swapped ? 1 / sar : sar,
    audioChannels: probe.streams
      .filter((stream) => stream.codec_type === 'audio')
      .map((stream) => {
        if (!stream.channels)
          throw new Error('An audio stream has no usable channel metadata.');
        return stream.channels;
      }),
  };
}

export function validateOutput(
  source: Probe,
  output: Probe,
  asset: VideoAsset,
): void {
  const original = videoStream(source);
  const result = videoStream(output);
  if (
    result.codec_name !== exportCodec(asset, original.codec_name) ||
    result.width !== asset.width ||
    result.height !== asset.height
  ) {
    throw new Error(
      'Output validation failed: video codec or oriented dimensions changed.',
    );
  }
  if (asset.colour.dynamicRange === 'sdr' && original.pix_fmt) {
    const formats =
      asset.colour.bitDepth === 10
        ? ['yuv420p10le', 'p010le']
        : ['yuv420p', 'yuvj420p', 'nv12'];
    if (
      !formats.includes(result.pix_fmt ?? '') ||
      original.color_range !== result.color_range ||
      original.color_space !== result.color_space ||
      original.color_primaries !== result.color_primaries ||
      original.color_transfer !== result.color_transfer
    )
      throw new Error(
        'Output SDR validation failed: bit depth or colour signalling changed. No output was published.',
      );
  }
  if (asset.colour.dynamicRange !== 'sdr') {
    const colour = asset.colour;
    if (
      result.profile !== 'Main 10' ||
      result.codec_tag_string !== 'hvc1' ||
      !['yuv420p10le', 'p010le'].includes(result.pix_fmt ?? '') ||
      result.color_primaries !== 'bt2020' ||
      result.color_space !== 'bt2020nc' ||
      result.color_transfer !==
        (colour.dynamicRange === 'hlg' ? 'arib-std-b67' : 'smpte2084') ||
      result.color_range !== (colour.range === 'limited' ? 'tv' : 'pc') ||
      result.side_data_list?.some((item) =>
        staleHdrMetadata.test(item.side_data_type ?? ''),
      )
    )
      throw new Error(
        'Output HDR validation failed: Main10, colour/range signalling or stale HDR metadata is incorrect. No output was published.',
      );
  }
  if (
    result.side_data_list?.some(
      (item) => item.rotation && Math.abs(item.rotation) > 0.001,
    )
  ) {
    throw new Error(
      'Output validation failed: an unexpected display rotation remains.',
    );
  }
  const frameRate = ratio(original.avg_frame_rate);
  const tolerance = Math.max(0.02, 1 / frameRate);
  const outputDuration = timestamp(output.format.duration, 'output duration');
  if (
    outputDuration <= 0 ||
    Math.abs(outputDuration - asset.duration) > tolerance + 0.001
  )
    throw new Error('Output duration is outside the one-frame/20ms tolerance.');
  const decoded =
    original.nb_read_frames !== undefined ||
    result.nb_read_frames !== undefined;
  const originalFrames = frameCount(
    decoded ? original.nb_read_frames : original.nb_frames,
  );
  const outputFrames = frameCount(
    decoded ? result.nb_read_frames : result.nb_frames,
  );
  if (originalFrames === undefined || outputFrames === undefined)
    throw new Error(
      'Frame counts could not be verified. No output was published.',
    );
  if (originalFrames !== outputFrames)
    throw new Error(
      `Output frame count changed: expected ${originalFrames} displayed frames, received ${outputFrames}. No output was published.`,
    );
  const before = source.streams.filter(
    (stream) => stream.codec_type === 'audio',
  );
  const after = output.streams.filter(
    (stream) => stream.codec_type === 'audio',
  );
  if (before.length !== after.length)
    throw new Error('Output audio-stream count changed.');
  before.forEach((audio, index) => {
    const encoded = after[index];
    if (
      !encoded ||
      encoded.codec_name !== 'aac' ||
      audio.channels !== encoded.channels ||
      (audio.channel_layout && audio.channel_layout !== encoded.channel_layout)
    ) {
      throw new Error(
        'Audio channels/layout are incompatible with this AAC export. No output was published.',
      );
    }
    const oldOffset =
      timestamp(audio.start_time, 'source audio start') -
      timestamp(original.start_time, 'source video start');
    const newOffset =
      timestamp(encoded.start_time, 'output audio start') -
      timestamp(result.start_time, 'output video start');
    if (Math.abs(oldOffset - newOffset) > 0.02)
      throw new Error('Output introduced more than 20ms of audio offset.');
  });
}
