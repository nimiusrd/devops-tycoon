import { defineConfig } from 'vitest/config';

// プレイテスト用オートプレイ（`npm run playtest`）。
// 通常のユニットテスト（`vitest.config.ts`）とは別 config にして、
// `npm test` / CI では回さない。実行に数分かかるため。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/playtest/**/*.test.ts'],
    // 旧出力の無効化は**テストモジュールの読み込みより前**に走らせる必要がある。
    // 詳細は `tests/playtest/globalSetup.ts` を参照。
    globalSetup: ['tests/playtest/globalSetup.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
