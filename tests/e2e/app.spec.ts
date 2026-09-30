/**
 * 端到端验收（docs/IMPLEMENTATION_PLAN.md 第 13.2、13.3 节）。
 *
 * 这些测试跑在**生产构建**上（playwright.config.ts 的 webServer 会先 build:only）。
 */
import { expect, test, type Page } from '@playwright/test';

/**
 * 导航到某个 hash 路由。
 *
 * 应用使用 HashRouter（为了在 GitHub Pages 上刷新深链不 404），
 * 因此路由必须写在 hash 内：/#/schedule 而不是 /schedule。
 */
async function goto(page: Page, route: string): Promise<void> {
  await page.goto(`/#${route}`);
}

/** 等待数据加载完成（元信息条出现即表示数据已就绪）。 */
async function waitForData(page: Page): Promise<void> {
  await expect(page.locator('.meta-bar')).toBeVisible({ timeout: 15_000 });
  // 等待派生视图渲染
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('13.2 用户流程', () => {
  test('1. 首屏能看到赛事状态与下一批比赛，并可搜索长队名', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);

    await expect(page.getByRole('heading', { level: 1, name: '总览' })).toBeVisible();
    // 赛事状态可见
    await expect(page.getByText(/赛事(尚未开始|进行中|已结束)/)).toBeVisible();
    // 首屏或一次点击内找到下一场：总览必须给出赛程入口
    await expect(page.getByRole('link', { name: /完整赛程|查看完整两日赛程/ }).first()).toBeVisible();

    // 搜索最长队名
    await goto(page, '/teams');
    await waitForData(page);
    await page.getByLabel('搜索队伍').fill('名字够长就一定会有人看队');
    await expect(page.getByText('名字够长就一定会有人看队')).toBeVisible();

    // 打开详情
    await page.getByRole('link', { name: /队伍详情/ }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('名字够长');
  });

  test('2. 排位赛同时两场可展示；展示组不出现在竞技排名中', async ({ page }) => {
    await goto(page, '/progress?view=qualification');
    await waitForData(page);

    // 出场安排表：每批两支队，标注两个场地
    await expect(page.getByText('出场安排（三审顺序）')).toBeVisible();
    await expect(page.getByRole('table', { name: '排位赛出场批次与场地' })).toBeVisible();

    // 三审排名与正式排名是分开的两块
    await expect(page.getByText('不是正式排名')).toBeVisible();
    await expect(page.getByText('正式排名', { exact: true })).toBeVisible();
  });

  test('3. 展示组抽签未录入时不虚构演出队伍', async ({ page }) => {
    await goto(page, '/progress?view=finals');
    await waitForData(page);
    // 种子未公布时明确显示待公布，不显示编造的队伍
    await expect(page.getByText('八强种子尚未公布')).toBeVisible();

    // 未抽签时展示组演出顺序不得沿用编号顺序
    await goto(page, '/teams/showcase-1');
    await waitForData(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('晓啸启宇队');
    // 明确提示等待抽签，且说明不会推测上台顺序
    await expect(page.getByText('抽签结果录入前，这里不会推测上台顺序')).toBeVisible();
    // 不应出现任何"第 N 队上台"的虚构结论
    await expect(page.getByText(/抽签第 \d 队上台/)).toHaveCount(0);
  });

  test('4. 长队名在两行内完整显示，比分不被挤出屏幕', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await goto(page, '/teams');
    await waitForData(page);

    const longest = page.getByText('名字够长就一定会有人看队').first();
    await expect(longest).toBeVisible();

    // 文本元素不超出视口宽度
    const box = await longest.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(376);
  });

  test('5. 比赛详情展示对阵、时间、状态与依赖关系', async ({ page }) => {
    await goto(page, '/progress?view=swiss&round=1');
    await waitForData(page);

    const detailLinks = page.getByRole('link', { name: '详情' });
    const count = await detailLinks.count();
    if (count > 0) {
      await detailLinks.first().click();
      await expect(page.getByText('对阵')).toBeVisible();
      await expect(page.getByText('时间与场地')).toBeVisible();
      await expect(page.getByText('相关比赛')).toBeVisible();
    }
  });

  test('6. 规则页解释公式、统计口径与资料来源', async ({ page }) => {
    await goto(page, '/rules');
    await waitForData(page);

    await expect(page.getByRole('heading', { level: 1, name: '规则与说明' })).toBeVisible();
    // 公式必须出现
    await expect(page.getByText(/R\s*=\s*0\.6\s*×\s*P\s*\+\s*0\.4\s*×\s*O/)).toBeVisible();
    await expect(page.getByText(/min\(s_k, 16\)/)).toBeVisible();
    // 时间权威性声明
    await expect(page.getByText(/仅供参考/)).toBeVisible();
    // 已知未明确项
    await expect(page.getByText(/以下内容原文未明确/)).toBeVisible();
  });

  test('7. 数据元信息区分"数据更新时间"与"最近成功检查时间"', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);
    await expect(page.getByText(/赛事数据更新于/)).toBeVisible();
    await expect(page.getByText(/最近成功检查/)).toBeVisible();
  });

  test('8. 深链直接打开可恢复筛选条件', async ({ page }) => {
    await goto(page, '/schedule?date=2026-10-04&stage=swiss');
    await waitForData(page);

    await expect(page.getByRole('heading', { level: 1, name: '赛程' })).toBeVisible();
    // 日期按钮处于选中状态
    const dateButton = page.getByRole('button', { name: /10月4日/ });
    await expect(dateButton).toHaveAttribute('aria-pressed', 'true');
    const stageButton = page.getByRole('button', { name: '瑞士轮' });
    await expect(stageButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('9. 队伍深链刷新后仍然可用（hash 路由不会 404）', async ({ page }) => {
    await goto(page, '/teams/competitive-18');
    await waitForData(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Uniforest');

    await page.reload();
    await waitForData(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Uniforest');
  });
});

test.describe('13.3 视觉与设备检查', () => {
  const widths = [360, 390, 768, 1440];

  for (const width of widths) {
    test(`页面本体在 ${width}px 无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const route of ['/', '/schedule', '/progress?view=qualification', '/progress?view=swiss', '/progress?view=finals', '/teams', '/rules']) {
        await goto(page, route);
        await waitForData(page);

        const overflow = await page.evaluate(() => {
          const el = document.documentElement;
          return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        });
        // 允许 1px 的取整误差
        expect(
          overflow.scrollWidth - overflow.clientWidth,
          `${route} 在 ${width}px 出现横向溢出`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }

  test('手机底部导航四项可用', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, '/');
    await waitForData(page);

    const tabbar = page.getByRole('navigation', { name: '底部导航' });
    await expect(tabbar).toBeVisible();
    for (const label of ['总览', '赛程', '晋级', '队伍']) {
      await expect(tabbar.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    }
  });

  test('键盘焦点可见（可用 Tab 到达导航）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/');
    await waitForData(page);

    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return { tag: el.tagName, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
    });
    expect(focused).not.toBeNull();
    // :focus-visible 生效时 outline 宽度不为 0
    expect(focused!.outlineWidth).not.toBe('0px');
  });

  test('减少动画设置生效', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goto(page, '/');
    await waitForData(page);

    const duration = await page.evaluate(() => {
      const el = document.querySelector('.card');
      if (!el) return null;
      return getComputedStyle(el).transitionDuration;
    });
    // 减少动画时过渡时长被压到接近 0（浏览器可能报告为 1e-06s 或 0s）
    if (duration !== null) {
      const seconds = Number.parseFloat(duration);
      expect(seconds, `transitionDuration=${duration}`).toBeLessThan(0.01);
    }
  });

  test('状态不只靠颜色传达（有文字标签）', async ({ page }) => {
    await goto(page, '/progress?view=swiss&round=1');
    await waitForData(page);

    // 徽章必须有可见文字
    const badges = page.locator('.badge');
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 8); i += 1) {
      const text = await badges.nth(i).innerText();
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

test.describe('13.2 发布与读取健壮性', () => {
  test('数据文件缺失时页面不崩溃并给出提示', async ({ page }) => {
    // 拦截数据请求返回 404
    await page.route('**/data/event.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await goto(page, '/');
    // 要么显示重试入口，要么显示错误提示；总之不能白屏
    await expect(
      page.getByText(/无法获取赛事数据|暂时无法更新|重试/).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('数据文件损坏时保留可用状态并给出提示', async ({ page }) => {
    await page.route('**/data/event.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{ this is not json' }),
    );
    await goto(page, '/');
    await expect(page.getByText(/无法获取赛事数据|暂时无法更新|重试/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('schema 不兼容时给出明确提示', async ({ page }) => {
    await page.route('**/data/event.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 99, revision: 'x', builtAt: '2026-01-01T00:00:00Z', sourceCommit: null, data: {} }),
      }),
    );
    await goto(page, '/');
    await expect(page.getByText(/无法获取赛事数据|暂时无法更新|重试/).first()).toBeVisible({ timeout: 15_000 });
  });

  test('公开构建不包含维护模式入口', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);

    // 页面中不应出现维护工具相关字样
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('维护工具');
    expect(body).not.toContain('变更包');
    // 不应暴露任何本地维护路由入口
    expect(body).not.toContain('operator.html');

    // operator.html 不得作为独立文档存在于公开产物中。
    // 注意：vite preview 对未知路径会回退到 index.html（SPA fallback），
    // 因此不能只看状态码——要确认返回的确实是观众站首页，而不是维护页面。
    const response = await page.request.get('/operator.html');
    if (response.status() === 200) {
      const html = await response.text();
      expect(html).toContain('RoboGame2026 赛程与结果');
      expect(html).not.toContain('维护工具');
      expect(html).not.toContain('src/operator');
    }
  });

  test('公开产物中不包含维护模式界面代码（构建期检查）', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);

    const scripts = await page.locator('script[src]').evaluateAll((els) =>
      els.map((el) => (el as HTMLScriptElement).getAttribute('src') ?? '').filter(Boolean),
    );
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const res = await page.request.get(src);
      expect(res.status()).toBe(200);
      const code = await res.text();
      // 维护工具界面特有的内容不得出现在公开 bundle 中。
      // 注意：schema 中的 changePackageSchema 是共享契约，会有 baseRevision 字样，
      // 因此这里检查的是**维护界面本身**的独有标识，而不是所有相关字段名。
      expect(code).not.toContain('operator-banner');
      expect(code).not.toContain('仅本机');
      expect(code).not.toContain('下载变更包 JSON');
      expect(code).not.toContain('维护工具');
      expect(code).not.toContain('rg26.operator.draft');
      // 不应打包维护模式入口模块
      expect(code).not.toContain('src/operator/main');
    }
  });
});
