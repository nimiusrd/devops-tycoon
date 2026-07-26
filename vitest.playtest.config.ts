import { defineConfig } from 'vitest/config';

// プレイテスト用オートプレイ（`npm run playtest`）。
// 通常のユニットテスト（`vitest.config.ts`）とは別 config にして、
// `npm test` / CI では回さない。実行に数分かかるため。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/playtest/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
