import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Stryker の Vitest runner は single-thread で dry run する。
// ペーシング統計など重いテストが既定の 5s を超えやすいので、ミューテーション時だけ緩和する。
// sprintTempo の F-4/F-5 行列は cards.ts を instrument すると beforeAll が 300s を超え、
// related テストとして sim-assign-cards の dry-run 全体を ConfigError で落とす。
export default mergeConfig(
  base,
  defineConfig({
    test: {
      testTimeout: 60_000,
      hookTimeout: 60_000,
      exclude: ['tests/unit/ui/sprintTempo.test.ts'],
    },
  }),
);
