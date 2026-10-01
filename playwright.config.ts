import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** 被测站点根地址。带子路径部署时用 E2E_BASE_URL 指到真实路径。 */
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`;

/**
 * 是否由 Playwright 自己拉起被测站点。
 *
 * `E2E_NO_WEBSERVER=1` 表示外部已经有人在 `E2E_BASE_URL` 上提供服务
 * （例如手工起的 preview、或线上站点），此时不再启动本地服务。
 */
const ownsWebServer = !process.env.E2E_NO_WEBSERVER;

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
    /*
      本地默认不录 trace。`retain-on-failure` 会在失败时写 test-results/，
      本机沙箱下这个写入可能失败（ENOENT .playwright-artifacts-N），
      于是真正的断言失败被一条 trace 写入错误盖掉，报错完全看不出原因。
      CI 里没有这个限制，仍然录 trace 便于排查。
    */
    trace: process.env.CI ? 'retain-on-failure' : 'off',
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
  webServer: ownsWebServer
    ? {
        /**
         * 启动被测站点。
         *
         * `E2E_SKIP_BUILD=1` 时**只启动 preview、不重新构建**。
         * 这条路径给「已经构建好、且不能让构建被覆盖」的场合用 ——
         * 例如 deploy.yml：那里先带 `VITE_BASE_PATH=<repo>/` 构建出
         * 线上真正要发布的产物，若 e2e 再跑一次 `build:only`，
         * 会用一个 `base:'/'` 的包覆盖掉它，随后上传到 Pages 的就是坏的。
         *
         * 注意此时 `E2E_BASE_URL` 必须带上子路径（如 /RG26/），
         * 否则会访问到 preview 的根路径而不是应用的真实入口。
         */
        command: process.env.E2E_SKIP_BUILD
          ? `npm run preview -- --port ${PORT} --strictPort`
          : `npm run build:only && npm run preview -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
});
