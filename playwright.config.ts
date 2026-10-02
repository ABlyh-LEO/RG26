import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** 被测站点根地址。带子路径部署时用 E2E_BASE_URL 指到真实路径。 */
const target = new URL(process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}/`);
target.pathname = `${target.pathname.replace(/\/+$/, '')}/`;
const BASE_URL = target.href;

/**
 * 是否由 Playwright 自己拉起被测站点。
 *
 * `E2E_NO_WEBSERVER=1` 表示外部已经有人在 `E2E_BASE_URL` 上提供服务
 * （例如手工起的 preview、或线上站点），此时不再启动本地服务。
 */
const ownsWebServer = process.env.E2E_NO_WEBSERVER !== '1';

/**
 * 被测站点是否部署在子路径下（GitHub Pages 项目站）。
 *
 * 从 E2E_BASE_URL 的路径部分推断，例如
 * `http://127.0.0.1:4173/RG26/` → `/RG26/`。
 * 与 Vite 构建和静态服务使用同一个前缀，避免资源落到站点根目录。
 */
const basePath = target.pathname;
const serverCommand = 'node scripts/serve-subpath.mjs --root dist';

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
  workers: process.env.CI ? 2 : undefined,
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
    ...(process.env.E2E_SKIP_WEBKIT === '1'
      ? []
      : [{ name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }]),
  ],
  webServer: ownsWebServer
    ? {
        /**
         * 启动被测站点。
         *
         * 默认按被测 URL 构建，再用严格静态服务托管根路径或子路径。
         * E2E_SKIP_BUILD=1 只验证已有 dist，部署时不会覆盖待发布产物。
         * Vite preview 支持 base，但在启动时重新读取配置；构建步骤的
         * VITE_BASE_PATH 不会自动传给后续步骤。这里直接挂载目标路径，
         * 且缺失资源返回 404，避免 SPA 回退掩盖路径错误。
         */
        command: process.env.E2E_SKIP_BUILD === '1'
          ? serverCommand
          : `npm run build:only && ${serverCommand}`,
        env: { E2E_BASE_URL: BASE_URL, VITE_BASE_PATH: basePath },
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
});
