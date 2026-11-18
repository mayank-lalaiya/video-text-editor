/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { DesktopApi } from '../shared/contracts.ts';

declare global {
  interface Window {
    readonly desktop?: DesktopApi;
  }
}
