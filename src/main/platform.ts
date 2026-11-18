export type MediaPlatform = 'darwin-arm64' | 'win32-x64';

export function mediaPlatform(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): MediaPlatform {
  if (platform === 'darwin' && architecture === 'arm64') return 'darwin-arm64';
  if (platform === 'win32' && architecture === 'x64') return 'win32-x64';
  throw new Error(
    'Use macOS 15+ on Apple silicon or Windows 10/11 on an x64 PC.',
  );
}

export function mediaToolPath(
  name: 'ffmpeg' | 'ffprobe' | 'media-guardian',
  target: MediaPlatform = mediaPlatform(),
): string {
  return `media-tools/${target}/${name}${target === 'win32-x64' ? '.exe' : ''}`;
}

export function resourceManifestName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? 'manifest.win32-x64.json' : 'manifest.json';
}
