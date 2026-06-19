import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !(globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'] as Record<string, unknown>,
    },
  ],
});
