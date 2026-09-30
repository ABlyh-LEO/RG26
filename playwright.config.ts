import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`;

/**
 * 浏览器来源：
 * - 默认使用 Playwright 自带的 Chromium/WebKit（CI 里通过 `playwright install` 获取）。
 * - 本机若无法下载浏览器，可用 E2E_CHROMIUM_CHANNEL=msedge 复用系统安装的
 *   Chromium 内核浏览器（Edge）。这仍然验证真实渲染，但必须在验收记录里
 *   写明用的是哪个内核，不能声称已验证 Playwright 自带版本。
 */
const channel = process.env.E2E_CHROMIUM_CHANNEL;

const chromiumUse = channel
  ? { ...devices['Desktop Chrome'], channel }
  : { ...devices['Desktop Chrome'] };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: chromiumUse },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], ...(channel ? { channel } : {}) } },
    { name: 'tablet-chromium', use: { ...devices['Galaxy Tab S4'], ...(channel ? { channel } : {}) } },
    // WebKit 只能由 Playwright 自带浏览器提供；下载不到时通过 E2E_SKIP_WEBKIT=1 跳过。
    ...(process.env.E2E_SKIP_WEBKIT
      ? []
      : [{ name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }]),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build:only && npm run preview -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
