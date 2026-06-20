import { defineConfig } from 'vitest/config';

// シミュレーション層（純TS）を最優先でテストする。
// 実ピクセル/操作の検証は Playwright（tests/e2e）に分離する（SPEC 第22.5）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
});
