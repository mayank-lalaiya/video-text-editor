import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'overlay' ? 'overlay-preload.cjs' : 'preload.cjs',
      },
    },
  },
});
