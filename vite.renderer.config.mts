import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const development = command === 'serve';
  const policy = [
    "default-src 'none'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    'font-src app-font:',
    "img-src 'self' data: app-media:",
    'media-src blob:',
    development
      ? "connect-src 'self' app-media: ws://localhost:* ws://127.0.0.1:*"
      : 'connect-src app-media:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');

  return {
    plugins: [
      react(),
      {
        name: 'local-content-policy',
        transformIndexHtml: (html) =>
          html.replace('__CONTENT_SECURITY_POLICY__', policy),
      },
    ],
  };
});
