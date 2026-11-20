/**
 * vite.config.ts — build tool config for the React UI.
 *
 * base: './'  → all asset URLs are relative, so the same build works when
 *               loaded from yaadein://app/ (desktop), http://<pc>:7777/ (phone
 *               browser) and inside the Capacitor mobile app.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000, // TensorFlow is big; that's expected
  },
  optimizeDeps: {
    // CommonJS packages that Vite should pre-bundle for the dev server
    include: ['@tensorflow-models/mobilenet', '@tensorflow-models/mobilenet/dist/imagenet_classes'],
  },
});
