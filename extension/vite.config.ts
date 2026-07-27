import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// MV3 extensions need stable, un-hashed entry filenames referenced by manifest.json.
// public/ (manifest.json, injected.js) is copied into dist/ verbatim by Vite.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // Content scripts cannot use ESM imports; bundle each entry standalone.
        format: 'es',
        inlineDynamicImports: false,
        manualChunks: undefined,
      },
    },
  },
});
