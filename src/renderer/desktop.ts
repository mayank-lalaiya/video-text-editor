import type { DesktopApi } from '../shared/contracts.ts';

export function getDesktopApi(): DesktopApi {
  if (!window.desktop)
    throw new Error(
      'The desktop bridge did not load. Restart or rebuild the application.',
    );
  return window.desktop;
}
