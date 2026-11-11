import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const SERVER = `http://127.0.0.1:${process.env.PORT ?? '8787'}`;

/**
 * The web app lives in src/web and is built into dist/web, which the Node server serves.
 * In development Vite serves the app on :5173 and proxies /api and /ws to the server.
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/web'),
  plugins: [
    react(),
    // The voice-activity-detection model, its audio worklet and the ONNX runtime are loaded
    // at run time by URL, so they are shipped as plain files under /vad/ (never from a CDN).
    viteStaticCopy({
      targets: [
        'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
        'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
        'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
        'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      ].map((file) => ({
        src: path.resolve(import.meta.dirname, file),
        dest: 'vad',
        // Copy the files themselves, not their node_modules/... directory structure.
        rename: { stripBase: true },
      })),
    }),
  ],
  // Inline (empty) PostCSS config: stops Vite from picking up a postcss.config.* in a parent folder.
  css: { postcss: { plugins: [] } },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/ws': { target: SERVER, ws: true, changeOrigin: false },
    },
  },
});
