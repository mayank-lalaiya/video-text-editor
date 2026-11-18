import type { VideoAsset, VideoColour } from '../../shared/editor.ts';
import { mediaPlatform, type MediaPlatform } from '../platform.ts';

type HdrTransfer = Exclude<VideoColour['dynamicRange'], 'sdr'>;
type HdrColour = Extract<VideoColour, { range: string }>;
type Channel = 'r' | 'g' | 'b';

const luma = '(0.2627*r(X,Y)+0.6780*g(X,Y)+0.0593*b(X,Y))';
const pixel = (channel: Channel) => `${channel}(X,Y)`;
const geq = (expression: (channel: Channel) => string) =>
  `geq=interpolation=nearest:${(['r', 'g', 'b'] as const)
    .map((channel) => `${channel}='${expression(channel)}'`)
    .join(':')}`;

// BT.2100 display-linear RGB in cd/m²; HLG uses the nominal 1000-nit,
// gamma-1.2 reference display. PQ constants are the exact ST 2084 fractions.
export function hdrDecodeFilters(transfer: HdrTransfer): string {
  if (transfer === 'pq') {
    return geq((channel) => {
      const power = `pow(clip(${pixel(channel)},0,1),1/78.84375)`;
      return `10000*pow(max(${power}-0.8359375,0)/(18.8515625-18.6875*${power}),1/0.1593017578125)`;
    });
  }
  return [
    geq((channel) => {
      const value = `clip(${pixel(channel)},0,1)`;
      return `if(lte(${value},0.5),pow(${value},2)/3,(exp((${value}-0.55991073)/0.17883277)+0.28466892)/12)`;
    }),
    geq((channel) => `1000*${pixel(channel)}*pow(max(${luma},0),0.2)`),
  ].join(',');
}

export function hdrEncodeFilters(transfer: HdrTransfer): string {
  if (transfer === 'pq') {
    return geq((channel) => {
      const power = `pow(max(${pixel(channel)}/10000,0),0.1593017578125)`;
      return `pow((0.8359375+18.8515625*${power})/(1+18.6875*${power}),78.84375)`;
    });
  }
  return [
    geq(
      (channel) =>
        `if(lte(${luma},0),0,${pixel(channel)}/1000*pow(${luma}/1000,-1/6))`,
    ),
    geq((channel) => {
      const value = `max(${pixel(channel)},0)`;
      return `if(lte(${value},1/12),sqrt(3*${value}),0.17883277*log(12*${value}-0.28466892)+0.55991073)`;
    }),
  ].join(',');
}

function hdrTags(colour: HdrColour): string {
  return `range=${colour.range}:color_primaries=bt2020:color_trc=${colour.dynamicRange === 'hlg' ? 'arib-std-b67' : 'smpte2084'}:colorspace=bt2020nc`;
}

function chromaScale(
  colour: HdrColour,
  size?: { width: number; height: number },
): string {
  return `scale=${size ? `w=${size.width}:h=${size.height}:` : ''}in_color_matrix=bt2020nc:out_color_matrix=bt2020nc:in_range=${colour.range}:out_range=${colour.range}:in_primaries=bt2020:out_primaries=bt2020:in_transfer=linear:out_transfer=linear:flags=bicubic+accurate_rnd`;
}

export function hdrInputFilters(
  colour: HdrColour,
  size?: { width: number; height: number },
): string {
  // Keep chroma resampling at 10 bits, then use the reference float backend
  // for exact range normalization. Automatic HDR-to-linear mapping clips
  // highlights, so only our explicit transfer functions perform that step.
  return [
    'sidedata=mode=delete',
    `setparams=range=${colour.range}:color_primaries=bt2020:color_trc=linear:colorspace=bt2020nc`,
    chromaScale(colour, size),
    'format=yuv444p10le',
    `scale=in_color_matrix=bt2020nc:out_color_matrix=0:in_range=${colour.range}:out_range=full:in_primaries=bt2020:out_primaries=bt2020:in_transfer=linear:out_transfer=linear:sws_backends=c`,
    'format=gbrpf32le',
    hdrDecodeFilters(colour.dynamicRange),
  ].join(',');
}

function textFilters(): string {
  return [
    'scale=in_range=full:out_range=full:in_primaries=bt709:out_primaries=bt709:in_transfer=linear:out_transfer=linear:sws_backends=c',
    'format=gbrpf32le',
    geq((channel) => {
      const value = pixel(channel);
      return `if(lte(${value},0.04045),${value}/12.92,pow((${value}+0.055)/1.055,2.4))`;
    }),
    'scale=in_color_matrix=0:out_color_matrix=0:in_range=full:out_range=full:in_primaries=bt709:out_primaries=bt2020:in_transfer=linear:out_transfer=linear:sws_backends=c',
    'format=gbrpf32le',
    geq((channel) => `203*${pixel(channel)}`),
  ].join(',');
}

export function exportCodec(
  asset: Pick<VideoAsset, 'colour'>,
  sourceCodec: string | undefined,
): 'h264' | 'hevc' {
  if (sourceCodec !== 'h264' && sourceCodec !== 'hevc')
    throw new Error('The original video codec could not be verified.');
  return asset.colour.dynamicRange !== 'sdr' ||
    asset.colour.bitDepth === 10 ||
    sourceCodec === 'hevc'
    ? 'hevc'
    : 'h264';
}

export function exportPlan(
  asset: Pick<VideoAsset, 'colour'>,
  videoIndex: number,
  sourceBitrate: number,
  sourceCodec: string | undefined,
  target: MediaPlatform = mediaPlatform(),
): { filter: string; encodingArgs: string[] } {
  const hevc = exportCodec(asset, sourceCodec) === 'hevc';
  const windows = target === 'win32-x64';
  if (!Number.isFinite(sourceBitrate) || sourceBitrate <= 0)
    throw new Error('A positive source video bitrate is required for export.');
  // Simple 10-bit sources still need headroom for newly added sharp glyphs.
  const tenBit =
    asset.colour.dynamicRange !== 'sdr' || asset.colour.bitDepth === 10;
  const bitrate = Math.max(
    tenBit ? 4000000 : 256000,
    Math.round(sourceBitrate * 1.5),
  );
  if (!Number.isSafeInteger(bitrate * 3))
    throw new Error('Source video bitrate exceeds the supported export range.');
  const rateControl = [
    '-b:v',
    String(bitrate),
    '-maxrate:v',
    String(Math.round(bitrate * 1.5)),
    '-bufsize:v',
    String(bitrate * 3),
  ];
  const { colour } = asset;
  const pixelFormat = tenBit ? (windows ? 'yuv420p10le' : 'p010le') : 'yuv420p';
  const encoder = windows
    ? hevc
      ? 'libx265'
      : 'libx264'
    : hevc
      ? 'hevc_videotoolbox'
      : 'h264_videotoolbox';
  const cpuOptions = windows
    ? [
        '-preset',
        'fast',
        '-bf',
        '0',
        ...(hevc ? ['-x265-params', 'log-level=error'] : []),
      ]
    : [];
  if (colour.dynamicRange === 'sdr') {
    return {
      filter: `[0:${videoIndex}][1:v:0]overlay=0:0:eof_action=repeat:format=${tenBit ? 'yuv420p10' : 'yuv420'}[out]`,
      encodingArgs: [
        '-map_metadata',
        '0',
        '-c:v',
        encoder,
        ...cpuOptions,
        '-profile:v',
        tenBit ? 'main10' : hevc ? 'main' : 'high',
        ...(hevc ? ['-tag:v', 'hvc1'] : []),
        ...rateControl,
        '-pix_fmt',
        pixelFormat,
        '-enc_time_base:v',
        'filter',
      ],
    };
  }
  return {
    filter: [
      `[0:${videoIndex}]${hdrInputFilters(colour)}[background]`,
      '[1:v:0]split=2[text][alpha]',
      `[text]${textFilters()}[graphics]`,
      '[alpha]alphaextract,scale=in_range=full:out_range=full:in_transfer=linear:out_transfer=linear:sws_backends=c,format=gbrpf32le[mask]',
      '[background][graphics][mask]maskedmerge=planes=7[composite]',
      `[composite]${hdrEncodeFilters(colour.dynamicRange)},setparams=range=full:color_primaries=bt2020:color_trc=linear:colorspace=gbr,scale=in_color_matrix=0:out_color_matrix=bt2020nc:in_range=full:out_range=${colour.range}:in_primaries=bt2020:out_primaries=bt2020:in_transfer=linear:out_transfer=linear:sws_backends=c,format=yuv444p10le,${chromaScale(colour)},format=${pixelFormat},setparams=${hdrTags(colour)}[out]`,
    ].join(';'),
    encodingArgs: [
      '-map_metadata',
      '-1',
      '-c:v',
      encoder,
      ...cpuOptions,
      '-profile:v',
      'main10',
      '-tag:v',
      'hvc1',
      ...rateControl,
      '-pix_fmt',
      pixelFormat,
      '-bsf:v',
      'dovi_rpu=strip=1',
      '-color_primaries',
      'bt2020',
      '-color_trc',
      colour.dynamicRange === 'hlg' ? 'arib-std-b67' : 'smpte2084',
      '-colorspace',
      'bt2020nc',
      '-color_range',
      colour.range === 'limited' ? 'tv' : 'pc',
      '-enc_time_base:v',
      'filter',
    ],
  };
}

export function posterFilters(
  asset: Pick<VideoAsset, 'colour'>,
  width: number,
  height: number,
): string {
  const { colour } = asset;
  if (colour.dynamicRange === 'sdr') return `scale=${width}:${height},setsar=1`;
  return [
    hdrInputFilters(colour, { width, height }),
    geq((channel) => `${pixel(channel)}/203`),
    'setparams=range=full:color_primaries=bt2020:color_trc=linear:colorspace=gbr',
    `tonemap=tonemap=mobius:param=0.3:desat=2:peak=${(colour.dynamicRange === 'hlg' ? 1000 : 10000) / 203}`,
    'scale=in_color_matrix=0:out_color_matrix=0:in_range=full:out_range=full:in_primaries=bt2020:out_primaries=bt709:in_transfer=linear:out_transfer=iec61966-2-1:sws_backends=c',
    'format=rgb24',
    'setparams=range=full:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=gbr',
    'setsar=1',
  ].join(',');
}
