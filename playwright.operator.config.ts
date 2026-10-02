import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/operator-e2e', testMatch: '*.spec.ts', fullyParallel: false, workers: 1,
  // CI 里允许重试一次：这些用例要起临时 Git 仓库、跑真实提交与推送，偶发超时
  // 不应把一次绿色 CI 变成红色（重试不会掩盖断言失败，失败仍会被报出）。
  retries: process.env.CI ? 1 : 0, timeout: 45_000, forbidOnly: !!process.env.CI,
  reporter: 'list', outputDir: 'test-results/operator',
  use: { baseURL: 'http://127.0.0.1:5399', trace: 'retain-on-failure' },
  projects: [
    { name: 'operator-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 },
      ...(process.env.E2E_CHROMIUM_CHANNEL ? { channel: process.env.E2E_CHROMIUM_CHANNEL } : {}) } },
    ...(process.env.E2E_SKIP_WEBKIT === '1' ? [] : [{ name: 'operator-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } }]),
  ],
  webServer: { command: 'node --import tsx tests/operator-e2e/server.ts', url: 'http://127.0.0.1:5399/operator.html',
    reuseExistingServer: false, timeout: 90_000 },
});
