import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Stryker の Vitest runner は single-thread で dry run する。
// ペーシング統計など重いテストが既定の 5s を超えやすいので、ミューテーション時だけ緩和する。
export default mergeConfig(
  base,
  defineConfig({
    test: {
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  }),
);
