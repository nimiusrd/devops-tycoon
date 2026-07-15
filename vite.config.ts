import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      output: {
        // RI-12: 重い vendor を安定チャンク名に分離し、キャッシュと初回転送を改善する。
        manualChunks(id) {
          if (
            id.indexOf('node_modules/pixi.js') !== -1 ||
            id.indexOf('node_modules/pixi-viewport') !== -1
          ) {
            return 'pixi';
          }
          if (id.indexOf('node_modules/framer-motion') !== -1) {
            return 'motion';
          }
        },
      },
    },
  },
});
