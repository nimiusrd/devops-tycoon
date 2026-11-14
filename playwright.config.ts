import { defineConfig, devices } from '@playwright/test';

// 視覚回帰・相互作用 E2E は実ブラウザ（Chromium）で少数に絞る（SPEC 第22.5）。
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5174;
const HOST = process.env.PLAYWRIGHT_HOST ?? DEFAULT_HOST;
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? DEFAULT_PORT);

if (!/^[a-zA-Z0-9.-]+$/.test(HOST)) {
  throw new Error('PLAYWRIGHT_HOST にはホスト名または IPv4 アドレスを指定してください。');
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error('PLAYWRIGHT_PORT には 1〜65535 の整数を指定してください。');
}

const baseURL = `http://${HOST}:${PORT}`;

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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore:
        /tab-conflict-modal|org-lever-spend-risk|rest-overlay-modal|sprint-board-frame-stability-1023/,
    },
    {
      name: 'chromium-conflict-modal',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /tab-conflict-modal/,
    },
    {
      name: 'webkit-conflict-modal',
      use: { ...devices['Desktop Safari'] },
      testMatch: /tab-conflict-modal/,
    },
    {
      name: 'webkit-org-lever-spend',
      use: { ...devices['Desktop Safari'] },
      testMatch: /org-lever-spend-risk/,
    },
    {
      name: 'webkit-org-lever-hint',
      use: { ...devices['Desktop Safari'] },
      testMatch: /org-lever-hint/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /sprint-result-quarter-goal|sprint-board-frame-stability-1023/,
    },
    {
      name: 'webkit-speed-hit-target',
      use: { ...devices['Desktop Safari'] },
      testMatch: /speed-button-hit-target/,
    },
    {
      name: 'webkit-rest-overlay-modal',
      use: { ...devices['Desktop Safari'] },
      testMatch: /rest-overlay-modal/,
    },
    {
      name: 'webkit-how-to-play-modal',
      use: { ...devices['Desktop Safari'] },
      testMatch: /how-to-play-modal/,
    },
  ],
  webServer: {
    command: `npm run ${process.env.PLAYWRIGHT_PREVIEW === '1' ? 'preview' : 'dev'} -- --host ${HOST} --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
