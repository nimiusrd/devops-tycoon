import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Stryker の Vitest runner は single-thread で dry run する。
// ペーシング統計など重いテストが既定の 5s を超えやすいので、ミューテーション時だけ緩和する。
// F-4/F-5 行列だけ除外する。sprintTempo.test.ts の軽量テスト（RunEngine.step など）は残す。
// cards.ts を instrument するとこの beforeAll が 300s を超え、sim-assign-cards の dry-run が落ちる。
export default mergeConfig(
  base,
  defineConfig({
    test: {
      testTimeout: 60_000,
      hookTimeout: 60_000,
      exclude: ['tests/unit/ui/sprintTempoPacing.test.ts'],
    },
  }),
);
