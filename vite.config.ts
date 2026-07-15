import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  build: {
    // Pixi は lazy チャンク側だけが参照する。エントリ HTML からの modulepreload に
    // 載せない（manualChunks で pixi を共有化すると Vite の preload ヘルパーが
    // pixi チャンクに寄り、エントリが静的 import してしまうため使わない）。
    modulePreload: {
      resolveDependencies(filename, deps) {
        return deps.filter((dep) => dep.indexOf('pixi') === -1);
      },
    },
    rollupOptions: {
      output: {
        // RI-12: framer-motion のみ安定 vendor チャンクに分離（エントリが静的参照）。
        // pixi.js は BoardPixiLayer 等の動的 import 経由の自然分割に任せる。
        manualChunks(id) {
          if (id.indexOf('node_modules/framer-motion') !== -1) {
            return 'motion';
          }
        },
      },
    },
  },
});
