import { defineConfig, devices } from '@playwright/test';

// 視覚回帰・相互作用 E2E は実ブラウザ（Chromium）で少数に絞る（SPEC 第22.5）。
const DEFAULT_PORT = 5174;
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? DEFAULT_PORT);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error('PLAYWRIGHT_PORT には 1〜65535 の整数を指定してください。');
}

const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Chromium の場所が特殊な環境向け（gallery の GALLERY_CHROMIUM と同じ発想）。
    ...(process.env.PLAYWRIGHT_CHROMIUM
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
