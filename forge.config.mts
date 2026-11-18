import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { createRequire } from 'node:module';
import { z } from 'zod';

const checksums = z
  .record(z.string(), z.string().regex(/^[0-9a-f]{64}$/))
  .parse(createRequire(import.meta.url)('electron/checksums.json'));

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'local.video-text-editor',
    appCategoryType: 'public.app-category.video',
    darwinDarkModeSupport: true,
    extendInfo: { LSMinimumSystemVersion: '15.0' },
    extraResource: ['resources'],
    // Validate cached Electron archives against the installed, pinned package.
    download: { checksums },
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin', 'win32'])],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/preload/overlay.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
