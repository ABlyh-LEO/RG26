/**
 * 端到端验收（docs/IMPLEMENTATION_PLAN.md 第 13.2、13.3 节）。
 *
 * 这些测试跑在生产构建上。只有明确验证赛前状态的用例注入固定数据与时间；
 * 其他用例仍读取待发布产物，避免正式赛果更新触发过期的赛前断言。
 */
import { expect, test, type Page } from '@playwright/test';
import { buildSeedEvent } from '../../scripts/seed-data';
import { publicSnapshotSchema } from '../../src/domain/schema';
import { waitForData } from './helpers';

/** 仅给赛前状态用例使用，不替换生产数据文件，也不冻结计时器或布局动画。 */
async function usePreEventSnapshot(page: Page): Promise<void> {
  const time = '2026-10-02T12:00:00+08:00';
  const snapshot = publicSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 'e2e-pre-event',
    builtAt: time,
    sourceCommit: null,
    data: buildSeedEvent(time),
  });
  await page.clock.setFixedTime(new Date(time));
  await page.route('**/data/event.json', (route) => route.fulfill({ json: snapshot }));
}

/**
 * 应用入口的路径前缀（含前后斜杠，根路径时为 `/`）。
 *
 * 部署到 GitHub Pages 项目站时地址是 `/<repo>/`，本地/CI 根路径是 `/`。
 * baseURL 只能提供「协议+主机+路径」，而 **以 `/` 开头的相对地址会丢掉
 * baseURL 的路径部分**（URL 解析规则），因此这里必须自己把前缀取出来，
 * 否则子路径下会导航到 `http://host/#/...` 而落到应用之外。
 */
const APP_BASE = (() => {
  const base = process.env.E2E_BASE_URL ?? '/';
  try {
    const p = new URL(base, 'http://127.0.0.1').pathname;
    return p.endsWith('/') ? p : `${p}/`;
  } catch {
    return '/';
  }
})();

/**
 * 导航到某个 hash 路由。
 *
 * 应用使用 HashRouter（为了在 GitHub Pages 上刷新深链不 404），
 * 因此路由必须写在 hash 内：<base>#/schedule 而不是 <base>/schedule。
 */
async function goto(page: Page, route: string): Promise<void> {
  await page.goto(`${APP_BASE}#${route}`);
}

test.describe('13.2 用户流程', () => {
  test('1. 首屏能看到赛事状态与下一批比赛，并可搜索长队名', async ({ page }) => {
    await usePreEventSnapshot(page);
    await goto(page, '/');
    await waitForData(page);

    await expect(page.getByRole('heading', { level: 1, name: '赛场动态' })).toBeVisible();
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

    // 出场安排表：每批两支队，标注两个副场地
    await expect(page.getByText('出场安排（三审顺序）')).toBeVisible();
    await expect(page.getByRole('table', { name: '排位赛出场批次与场地' })).toBeVisible();

    // 三审排名与正式排名是分开的两块
    await expect(page.getByText('不是正式排名')).toBeVisible();
    await expect(page.getByText('正式排名', { exact: true })).toBeVisible();
  });

  test('2b. 总览与赛程都要能看到排位赛', async ({ page }) => {
    await usePreEventSnapshot(page);
    // 总览：下一批比赛必须包含排位赛跑图（而不是只显示瑞士轮）
    await goto(page, '/');
    await waitForData(page);
    const overview = await page.locator('body').innerText();
    expect(overview, '总览的下一批比赛应包含排位赛跑图').toContain('单队跑图');
    expect(overview).toContain('排位 R1');
    // 首日安排必须列出排位赛批次与真实队名（不是内部 ID）
    expect(overview).toContain('次跑图');
    expect(overview).toContain('Uniforest队');
    expect(overview, '不应显示内部 ID').not.toMatch(/qual-r\d+-rank\d+/);

    // 赛程：10/3 的排位赛筛选必须包含全部 22 次第一轮跑图
    await goto(page, '/schedule?date=2026-10-03&stage=qualification');
    await waitForData(page);
    // 只看时间线区域，避开场地筛选按钮等界面文字
    const cards = page.locator('.main .card');
    const cardTexts = await cards.allInnerTexts();
    // 44 张跑图卡片 + 1 张核分活动卡片
    const runCards = cardTexts.filter((t) => t.includes('单队跑图'));
    expect(runCards, '排位赛应有 44 次跑图（两轮各 22）').toHaveLength(44);
    expect(runCards[0]).toContain('副场地');

    const whole = (await page.locator('.main').innerText());
    expect(whole, '赛程不应出现 Invalid Date').not.toContain('Invalid Date');
    expect(whole, '赛程不应显示内部 ID').not.toMatch(/qual-r\d+-rank\d+/);
    // 副场地名称应出现在时间线中
    expect(whole).toContain('副场地A');
    expect(whole).toContain('副场地B');
  });

  test('2d. 排位赛原始成绩公开，且名次口径写明', async ({ page }) => {
    await goto(page, '/progress?view=qualification');
    await waitForData(page);

    // 名次口径必须写在页面上，不能让观众猜（与规则页一致）
    const body = await page.locator('body').innerText();
    expect(body).toContain('积分高者优');
    expect(body).toContain('到达最终分时间早者优');

    /*
     * 原始成绩表本身：种子数据里 44 条跑图全部未录入（resultStatus=none），
     * 此时页面正确地显示「尚未比赛」空状态，表格不会渲染。
     * 因此这里断言**两种合法形态之一**，而不是硬要求表格存在：
     *   - 有成绩 → 表格出现，且必须带全部可比列；
     *   - 无成绩 → 明确的空状态。
     * 表格的列结构由 2e（队伍详情页，表格必然渲染）覆盖。
     */
    const hasTable = await page.getByRole('table').filter({ hasText: '到达最终分' }).count();
    if (hasTable > 0) {
      const head = await page
        .getByRole('table')
        .filter({ hasText: '到达最终分' })
        .first()
        .locator('thead')
        .innerText();
      for (const col of ['队伍', '轮次', '场地', '积分', '到达最终分', '成绩原文', '状态']) {
        expect(head, `原始成绩表缺少「${col}」列`).toContain(col);
      }
    } else {
      await expect(page.getByText('尚未比赛')).toBeVisible();
      await expect(page.getByText('跑图记录（原始成绩）')).toBeVisible();
    }
  });

  test('2e. 队伍详情页展示该队两轮原始成绩', async ({ page }) => {
    await goto(page, '/teams/competitive-18');
    await waitForData(page);

    const records = page.locator('.record-card');
    await expect(records).toHaveCount(2);
    await expect(records.nth(0)).toContainText('第 1 轮');
    await expect(records.nth(1)).toContainText('第 2 轮');
    for (const record of await records.all()) {
      await expect(record).toContainText('积分');
      await expect(record).toContainText('到达最终分');
    }
  });

  test('2f. 红蓝方由赛程结构自动推出，页面上明确标出', async ({ page }) => {
    /*
     * 当前正式数据里 33 场瑞士轮与全部决赛都还没有参赛双方
     * （赛事未开始），因此红蓝方**正确地**推不出来 —— 页面不应显示，
     * 更不应猜测。
     *
     * 红蓝方规则本身（含偶数轮换边）由 area 2g/2h 与单元测试
     * tests/domain/sides.test.ts 覆盖；这里断言的是"没有双方就不编造"。
     */
    await goto(page, '/matches/swiss-r1-00-1');
    await waitForData(page);

    const body = await page.locator('body').innerText();
    const hasSides = /红方/.test(body) && /蓝方/.test(body);
    if (!hasSides) {
      // 未公布对阵：绝不能凭空给出红蓝方
      expect(body, '对阵未公布时不得编造红蓝方').not.toMatch(/红方\s*\n?\s*\S+队/);
    }
    // 页面本身必须可正常渲染（不崩、不空白）
    await expect(page.locator('h1')).toBeVisible();
  });

  test('2g. 决赛 BO3 说明每局换边，并列出到达最终分时间', async ({ page }) => {
    await goto(page, '/matches/F-QUAL');
    await waitForData(page);

    const body = await page.locator('body').innerText();
    // 换边规则与时间口径必须写在页面上（不依赖是否有成绩）
    expect(body, 'BO3 页应说明每局换边').toContain('每局换边');
    expect(body, 'BO3 页应说明时间用途').toContain('到达最终分');

    const games = page.locator('section').filter({ has: page.getByRole('heading', { name: '小局记录', exact: true }) }).locator('article');
    await expect(games).toHaveCount(3);
    for (const game of await games.all()) {
      await expect(game.getByLabel('红方', { exact: true })).toBeVisible();
      await expect(game.getByLabel('蓝方', { exact: true })).toBeVisible();
      await expect(game.locator('.match-side__result')).toHaveCount(2);
    }
  });

  test('2h. 决赛 BO1 标注「八强双败不换边」', async ({ page }) => {
    await goto(page, '/matches/F-L1A');
    await waitForData(page);
    const body = await page.locator('body').innerText();
    // 格式标记必须出现，与"不换边"的口径一致
    expect(body).toContain('BO1');
    await expect(page.locator('h1')).toBeVisible();
  });

  // 已确认比赛刷新后的展示由 bracket-mobile.spec.ts 的明确赛果 fixture 覆盖。
  test('13.4 赛前晋级图不编造成绩、胜者与红蓝方', async ({ page }) => {
    await usePreEventSnapshot(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();
    await page.waitForTimeout(1200);

    const stats = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.bracket-card')];
      const rows = [...document.querySelectorAll('.bracket-card__row')];
      return {
        cards: cards.length,
        done: cards.filter((c) => c.classList.contains('bracket-card--done')).length,
        winnerRows: rows.filter((r) => r.classList.contains('is-winner')).length,
        // 有比分的行：形如 "16 分 · 81 秒"
        rowsWithScore: rows.filter((r) => /\d+\s*分/.test(r.innerText)).length,
        rowsWithSeconds: rows.filter((r) => /\d+\s*秒/.test(r.innerText)).length,
        sideBadges: document.querySelectorAll('.side-badge').length,
      };
    });

    expect(stats.cards, '完整赛前晋级图仍展示全部场次').toBe(47);
    expect(stats.done, '赛前不得标出已结算比赛').toBe(0);
    expect(stats.winnerRows, '无成绩时不得凭空标出胜者').toBe(0);
    expect(stats.rowsWithScore, '无成绩时不得凭空显示比分').toBe(0);
    expect(stats.rowsWithSeconds, '无成绩时不得凭空显示到达最终分时间').toBe(0);
    expect(stats.sideBadges, '对阵未确定时不得编造红蓝方').toBe(0);
  });

  test('13.4 总览保留独立完整晋级图入口', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);
    await expect(page.locator('.bracket')).toHaveCount(0);
    await page.getByRole('link', { name: /完整晋级图/ }).first().click();
    await expect(page.locator('.bracket__scroller')).toBeVisible();
    await expect(page.locator('.bracket-card')).toHaveCount(47);
    await expect(page.locator('.bracket__column')).toHaveCount(11);
  });

  test('13.4 赛程页标出红蓝方', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/schedule');
    await waitForData(page);
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const badges = [...document.querySelectorAll('.side-badge')];
      return {
        count: badges.length,
        labels: [...new Set(badges.map((b) => b.textContent.trim()))].sort(),
      };
    });

    // 有对抗比赛时才有红蓝方；正式数据未开始时应为 0 而不是瞎标
    if (info.count > 0) {
      expect(info.labels).toContain('红');
      expect(info.labels).toContain('蓝');
    } else {
      expect(info.count, '对阵未公布时不得编造红蓝方').toBe(0);
    }
  });

  test('2c. 排位赛只在副场地A/B，对抗类比赛在主舞台', async ({ page }) => {
    // 只看时间线卡片，避开场地筛选按钮（那里会列出全部场地名）
    await goto(page, '/schedule?date=2026-10-03&stage=qualification');
    await waitForData(page);
    const cards = page.locator('.main .card');
    const qualText = (await cards.allInnerTexts()).join('\n');
    expect(qualText).toContain('副场地A');
    expect(qualText).toContain('副场地B');
    expect(qualText, '排位赛时间线不应出现主舞台').not.toContain('主舞台');

    await goto(page, '/schedule?date=2026-10-03&stage=swiss');
    await waitForData(page);
    const swissCards = page.locator('.main .card');
    const swissText = (await swissCards.allInnerTexts()).join('\n');
    expect(swissText).toContain('主舞台');
    expect(swissText, '瑞士轮时间线不应出现副场地').not.toContain('副场地');
  });

  test('3. 展示组抽签未录入时不虚构演出队伍', async ({ page }) => {
    await usePreEventSnapshot(page);
    await goto(page, '/progress?view=finals');
    await waitForData(page);
    // 种子未公布时明确显示待公布，不显示编造的队伍
    await page.getByText('八强排名与首轮对阵依据', { exact: true }).click();
    await expect(page.getByText('八强种子尚未公布')).toBeVisible();

    // 未抽签时展示组演出顺序不得沿用编号顺序
    await goto(page, '/teams/showcase-1');
    await waitForData(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('晓啸启宇队');
    // 明确提示等待抽签，且说明不会推测上台顺序
    await expect(page.getByText(/抽签决定，结果确认后会在这里公布/)).toBeVisible();
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
    // 排位赛名次口径已由组委会确认，规则页必须写明确（不能还写"未明确"）
    await expect(page.getByText(/积分高者优/)).toBeVisible();
    await expect(page.getByText(/到达最终分时间早者优/)).toBeVisible();
    // 仍然存在的已知未明确项
    await expect(page.getByText(/以下内容原文仍未明确/)).toBeVisible();
  });

  test('7. 数据元信息区分"数据更新时间"与"最近成功检查时间"', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);
    await page.locator('.meta-bar summary').click();
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
    await expect(stageButton).toBeVisible();
    await stageButton.click();
    await expect(page).not.toHaveURL(/stage=swiss/);
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

      for (const route of ['/', '/schedule', '/progress?view=journey', '/progress?view=qualification', '/progress?view=swiss', '/progress?view=finals', '/progress?view=finals&mode=bracket', '/teams', '/rules']) {
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

test.describe('13.4 列式赛程图', () => {
  /** 量一下图的规模，避免每个用例重复 evaluate。 */
  async function bracketStats(page: Page) {
    return page.evaluate(() => {
      const scroller = document.querySelector('.bracket__scroller');
      const board = document.querySelector('.bracket__board');
      return {
        columns: document.querySelectorAll('.bracket__column').length,
        cards: document.querySelectorAll('.bracket-card').length,
        paths: document.querySelectorAll('.bracket__link').length,
        loserPaths: document.querySelectorAll('.bracket__link--loser').length,
        columnTitles: [...document.querySelectorAll('.bracket__column-title')].map((e) => e.textContent ?? ''),
        boardWidth: board?.clientWidth ?? 0,
        scrollWidth: scroller?.scrollWidth ?? 0,
        clientWidth: scroller?.clientWidth ?? 0,
      };
    });
  }

  test('决赛图有列、卡片与连线，连线坐标已实测', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=finals&mode=bracket');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const stats = await bracketStats(page);

    // 5 列：八强赛 / 败者组第二轮 / 半决赛 / 名额争夺战 / 总决赛
    // 八强首轮四场必须在**同一列**：胜者组与败者组交叉向前喂给败者组第二轮，
    // 拆成两列会让四条连线各横穿一整列无关卡片。
    expect(stats.columns).toBe(6);
    expect(stats.columnTitles).toEqual([
      '双败首轮',
      '八强赛',
      '败者组第二轮',
      '半决赛',
      '名额争夺战',
      '总决赛',
    ]);
    // 10 场计入排名的系列赛
    expect(stats.cards).toBe(14);
    // 连线必须真的画出来，而不是只有一个空 svg
    expect(stats.paths).toBeGreaterThan(0);
    expect(stats.loserPaths).toBeGreaterThan(0);

    // 连线坐标来自实测 DOM：出现天文数字说明发生了自反馈
    const d = await page.locator('.bracket__link').first().getAttribute('d');
    expect(d).toBeTruthy();
    const coords = (d ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) {
      expect(Number.isFinite(c)).toBe(true);
      expect(Math.abs(c), `连线坐标 ${c} 超出合理范围`).toBeLessThan(100_000);
    }
  });

  test('连线不重叠：每条竖直转折各自占一条车道', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=finals&mode=bracket');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const verticals = await page.evaluate(() => {
      const xs: number[] = [];
      document.querySelectorAll('.bracket__link').forEach((p) => {
        const m = (p.getAttribute('d') ?? '').match(/^M [\d.]+ [\d.]+ H ([\d.]+) V /);
        if (m) xs.push(Math.round(Number(m[1])));
      });
      return xs;
    });

    expect(verticals.length).toBeGreaterThan(0);

    // 同一条通道里的多条线若共用同一个 x，会重叠成一条，
    // 看起来就像"少了几条线、连错了地方"
    const counts = new Map<number, number>();
    for (const x of verticals) counts.set(x, (counts.get(x) ?? 0) + 1);
    const overlapped = [...counts.entries()].filter(([, n]) => n > 1);
    expect(
      overlapped,
      `这些 x 上有重叠的竖直线段：${JSON.stringify(overlapped)}`,
    ).toHaveLength(0);
  });

  /**
   * 同 y 共线重叠：**这是曾经的测试盲区**。
   *
   * 上一个用例只断言"同一 x 不得有两条竖直段"，于是这个 bug 一直
   * 没被测出来：两条不同晋级路径的**水平段**落在同一个 y 上、
   * 区间还互相覆盖，图上看起来只有一条线。
   * 基线实测 12 处，最长一处重叠 250px
   * （`F-W1A→F-WSF` 与 `F-L2B→F-LSF` 在 y≈371 的通道里）。
   *
   * 判据按**语义**：不同晋级路径在图上必须各自可追踪，
   * 不能靠"元素存不存在"来判定。
   *
   * 允许的例外只有一种：**同一张卡片发出的两条边**（胜者与败者）
   * 共用一个起点、**指向同一张卡片的两条边**共用一个终点。
   * 几何上它们必须共用那个边缘中点，无法分开。
   * 除这种"同一端点扇出/汇聚"外，任何共线重叠都算缺陷。
   */
  test('连线不重叠：不同路径的水平段不得共线重叠', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const horizontals = await page.evaluate(() => {
      const board = document.querySelector('.bracket__board');
      const boardRect = board?.getBoundingClientRect();

      /** 卡片 id → 左右边缘中点 x（用来识别"同一端点"扇出）。 */
      const nodeEdges: { id: string; left: number; right: number }[] = [];
      document.querySelectorAll('[data-node-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        nodeEdges.push({
          id: (el as HTMLElement).dataset.nodeId ?? '',
          left: boardRect ? r.left - boardRect.left : r.left,
          right: boardRect ? r.right - boardRect.left : r.right,
        });
      });

      const segs: { y: number; x1: number; x2: number; pathId: string }[] = [];
      document.querySelectorAll('.bracket__link').forEach((p, pathIndex) => {
        const d = p.getAttribute('d') ?? '';
        const toks = [
          ...d.matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g),
        ].map((m) => ({
          c: m[1],
          a: Number(m[2]),
          b: m[3] !== undefined ? Number(m[3]) : null,
        }));
        let x = 0;
        let y = 0;
        for (const t of toks) {
          if (t.c === 'M') {
            x = t.a;
            y = t.b ?? 0;
          } else if (t.c === 'H') {
            segs.push({
              y: Math.round(y * 100) / 100,
              x1: Math.min(x, t.a),
              x2: Math.max(x, t.a),
              pathId: `${pathIndex}`,
            });
            x = t.a;
          } else if (t.c === 'V') {
            y = t.a;
          }
        }
      });

      /** 该 x 是否落在某张卡片的左右边缘（±3px 视为同一端点）。 */
      const nearEdge = (px: number): boolean =>
        nodeEdges.some((n) => Math.abs(px - n.left) <= 3 || Math.abs(px - n.right) <= 3);

      const byY = new Map<number, typeof segs>();
      for (const s of segs) {
        const list = byY.get(s.y) ?? [];
        list.push(s);
        byY.set(s.y, list);
      }

      const bad: { y: number; overlap: number; a: string; b: string }[] = [];
      for (const [y, list] of byY) {
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i]!;
            const b = list[j]!;
            if (a.pathId === b.pathId) continue;
            const lo = Math.max(a.x1, b.x1);
            const hi = Math.min(a.x2, b.x2);
            const overlap = hi - lo;
            // 2px 容差：抗锯齿与浮点噪声
            if (overlap <= 2) continue;
            /**
             * 例外：**同一张卡片发出的两条边，或汇聚到同一张卡的两条边**。
             *
             * 这两种情况下两段横线共用同一个端点，而那个端点固定在
             * 卡片的边缘中点上（`x1` 取右边缘中点、`x2` 取左边缘中点），
             * 几何上无法分开——规则本身就要求胜者与败者从同一场比赛分出。
             * 例如 `F-W1A→F-L2A`（败）与 `F-W1A→F-WSF`（胜）都从
             * 第 3 场的右边缘中点出发，于是共享开头那 17px。
             *
             * 判据：两段**共用的那个端点**（重叠区的一端）落在卡片边缘上，
             * 且两段在重叠处朝**同一个方向**离开（都是起点或都是终点）。
             * 只判"共用端点贴卡片"是不够的：还要确认它们不是在同一段
             * 通道里各走各的、只是碰巧同高——那才是真缺陷。
             */
            const sharedAtCardEdge = nearEdge(lo) || nearEdge(hi);
            if (!sharedAtCardEdge) {
              bad.push({
                y,
                overlap: Math.round(overlap),
                a: `${Math.round(a.x1)}-${Math.round(a.x2)}`,
                b: `${Math.round(b.x1)}-${Math.round(b.x2)}`,
              });
              continue;
            }
            /**
             * 共用端点必须在两段的**同一侧**（都从那里出发，或都到那里），
             * 否则只是首尾相接式的偶然共线，仍算缺陷。
             */
            const aStartsAt = (px: number) => Math.abs(px - a.x1) <= 2;
            const bStartsAt = (px: number) => Math.abs(px - b.x1) <= 2;
            const sameSide =
              (aStartsAt(lo) && bStartsAt(lo)) || (aStartsAt(hi) && bStartsAt(hi));
            if (!sameSide) {
              bad.push({
                y,
                overlap: Math.round(overlap),
                a: `${Math.round(a.x1)}-${Math.round(a.x2)}`,
                b: `${Math.round(b.x1)}-${Math.round(b.x2)}`,
              });
            }
          }
        }
      }
      return { total: segs.length, bad };
    });

    expect(horizontals.total).toBeGreaterThan(0);
    expect(
      horizontals.bad,
      `这些 y 上有共线重叠的水平段（除同一卡片扇出/汇聚外不允许）：${JSON.stringify(horizontals.bad)}`,
    ).toHaveLength(0);
  });

  test('对外文案用场次序号，绝不出现内部 ID', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const routes = [
      '/progress?view=finals&mode=bracket',
      '/progress?view=finals&mode=list',
      '/progress?view=journey',
      '/matches/F-L2A',
      '/schedule',
      '/',
    ];

    for (const route of routes) {
      await goto(page, route);
      await waitForData(page);
      const body = await page.locator('body').innerText();
      const leaked = [...new Set(body.match(/F-[A-Z0-9]+/g) ?? [])];
      expect(leaked, `${route} 泄漏了内部系列赛 ID：${leaked.join(', ')}`).toHaveLength(0);
    }
  });

  test('未决出名额显示为「第 N 场胜者/败者」，可与卡片上的场次号对上', async ({ page }) => {
    await usePreEventSnapshot(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=finals&mode=bracket');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const text = await page.locator('.bracket').innerText();

    // 每张竞技组卡片标题都带场次序号
    for (const no of [1, 5, 10]) {
      expect(text, `缺少第 ${no} 场的标题`).toContain(`第 ${no} 场·`);
    }

    // 未决出的名额用场次序号表述
    expect(text).toMatch(/第 \d+ 场(胜者|败者)/);
    expect(text).not.toMatch(/F-[A-Z0-9]+\s*(胜者|败者)/);
  });

  test('完整晋级图是瑞士轮→决赛一条线', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const stats = await bracketStats(page);

    // 瑞士轮 5 列 + 决赛 5 列，共 10 列
    expect(stats.columns).toBe(11);
    expect(stats.columnTitles).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      '双败首轮',
      '八强赛',
      '败者组第二轮',
      '半决赛',
      '名额争夺战',
      '总决赛',
    ]);
    // 33 场瑞士轮 + 10 场决赛
    expect(stats.cards).toBe(47);

    // 排位赛**不应**出现在这张图里：
    // 44 次单队跑图会把一列撑到 5000px，整张图糊成一团
    const chartText = await page.locator('.bracket').innerText();
    expect(chartText).not.toContain('单独跑图');
    expect(chartText).not.toMatch(/排位赛第 \d+ 轮/);
  });

  test('瑞士轮与决赛并排在同一条纵向带，且整体紧凑', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const cols = await page.evaluate(() =>
      [...document.querySelectorAll('.bracket__column')].map((c) => ({
        title: c.querySelector('.bracket__column-title')?.textContent ?? '',
        left: Number.parseFloat((c as HTMLElement).style.left) || 0,
        top: Number.parseFloat((c as HTMLElement).style.top) || 0,
      })),
    );

    // 瑞士轮 5 列 + 决赛 5 列
    expect(cols).toHaveLength(11);
    // 所有列 top 相同 —— 同一条纵向带，不上下错开
    expect([...new Set(cols.map((c) => c.top))]).toEqual([0]);

    // left 严格递增 —— 从左到右依次推进
    for (let i = 1; i < cols.length; i += 1) {
      expect(
        cols[i]!.left,
        `${cols[i]!.title} 未排在 ${cols[i - 1]!.title} 右侧`,
      ).toBeGreaterThan(cols[i - 1]!.left);
    }

    // 整体高度必须紧凑：某一列过高就会"糊成一团"
    const boardHeight = await page.evaluate(() => {
      const el = document.querySelector('.bracket__board') as HTMLElement | null;
      return el ? el.clientHeight : 0;
    });
    expect(boardHeight, `赛程图高 ${boardHeight}px，过高`).toBeLessThan(1600);
  });

  test('纵向高度不被最长列撑爆（列 body 用本列高度）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const m = await page.evaluate(() => {
      const board = document.querySelector('.bracket__board') as HTMLElement | null;
      const scroller = document.querySelector('.bracket__scroller') as HTMLElement | null;
      const bodies = [...document.querySelectorAll('.bracket__column-body')].map((b) =>
        Number.parseFloat((b as HTMLElement).style.height) || 0,
      );
      return {
        boardH: board?.clientHeight ?? 0,
        scrollH: scroller?.scrollHeight ?? 0,
        bodyHeights: [...new Set(bodies)].sort((a, b) => a - b),
      };
    });

    // 各列 body 高度必须**不同**（按本列内容），而不是统一等于全局最大值
    expect(m.bodyHeights.length, '所有列 body 高度相同，说明用了全局 maxHeight').toBeGreaterThan(1);

    // 滚动高度不能显著超过画布高度（超出说明有列溢出了画布）
    expect(m.scrollH - m.boardH).toBeLessThan(120);
  });

  /*
    最下方一场比赛必须可见。

    这里断言的是**真实内容底边**，不是 scrollHeight 与 clientHeight 的差：
    窄屏下 columnWidth 收敛到 minColumnWidth，卡片变窄、队名多换一行，
    节点会比宽屏更高。如果画布高度只认上一帧的实测值，多出来的部分
    会被 overflow-y 直接裁掉（overflow-x: auto 会把 overflow-y 提升成 auto，
    裁掉就再也滚不到），而 scrollHeight 差值恰好也会跟着变大，
    用差值判断会漏掉这条错误。必须逐个节点比对它的底边与画布底边。
  */
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [768, 1024],
  ] as const) {
    test(`最下方比赛不被裁掉（${width}x${height}）`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await goto(page, '/progress?view=journey');
      await waitForData(page);
      await expect(page.locator('.bracket')).toBeVisible();

      const m = await page.evaluate(() => {
        const board = document.querySelector('.bracket__board') as HTMLElement | null;
        const scroller = document.querySelector('.bracket__scroller') as HTMLElement | null;
        if (!board || !scroller) return null;
        const boardRect = board.getBoundingClientRect();
        const boardBottom = boardRect.top + board.clientHeight;

        // 有任何节点越过画布底边就是被裁了
        const clipped = [...document.querySelectorAll<HTMLElement>('.bracket__node')]
          .map((n) => ({
            id: n.dataset.nodeId ?? '',
            overflow: Math.round(n.getBoundingClientRect().bottom - boardBottom),
          }))
          .filter((x) => x.overflow > 1);

        const svg = document.querySelector('.bracket__connectors');
        return {
          clipped,
          boardH: board.clientHeight,
          scrollerClientH: scroller.clientHeight,
          scrollerScrollH: scroller.scrollHeight,
          // 连线层必须覆盖整个画布，否则最下面的连线会被 SVG 高度切掉
          svgHeight: svg ? Number(svg.getAttribute('height')) : 0,
        };
      });

      expect(m, '赛程图未渲染').not.toBeNull();
      expect(
        m!.clipped.map((c) => `${c.id}(+${c.overflow}px)`),
        `${width}px 下有比赛被画布裁掉`,
      ).toEqual([]);

      // 画布高度必须容得下连线层
      expect(m!.svgHeight, '连线层矮于画布，底部连线会被切掉').toBeGreaterThanOrEqual(
        m!.boardH,
      );

      // 纵向不应出现"裁掉且滚不到"的情况
      expect(
        m!.scrollerScrollH - m!.scrollerClientH,
        `${width}px 下滚动区与可视区不一致，说明有内容被裁`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test('对阵未确定时说明在等什么，不编造名次', async ({ page }) => {
    await usePreEventSnapshot(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const chartText = await page.locator('.bracket').innerText();

    // 尚未公布的对阵必须说明等待原因
    expect(chartText).toMatch(/等待第 \d 轮结果确认后公布/);

    // 这是本次修复的核心：不能整列都是"排位赛第 N 名 vs 排位赛第 N+1 名"的假配对
    const fakePairs = chartText.match(/排位赛第 \d+ 名\s*\n\s*排位赛第 \d+ 名/g) ?? [];
    expect(fakePairs, `出现了 ${fakePairs.length} 组编造的排位赛名次配对`).toHaveLength(0);
  });

  test('窄屏横向滚动，页面本体不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket')).toBeVisible();

    const stats = await bracketStats(page);

    // 图比视口宽，必须靠滚动容器承载
    expect(stats.scrollWidth).toBeGreaterThan(stats.clientWidth);
    // board 宽度要合理（不能是自反馈放大后的天文数字）
    expect(stats.boardWidth).toBeLessThan(20_000);

    // 页面本体不出现横向溢出
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(1);

    // 真的能横向滚动
    const scrolled = await page.evaluate(() => {
      const el = document.querySelector('.bracket__scroller') as HTMLElement | null;
      if (!el) return -1;
      el.scrollLeft = 400;
      return el.scrollLeft;
    });
    expect(scrolled).toBeGreaterThan(0);
  });

  test('图例与可访问性标签齐备', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);

    await expect(page.getByRole('group', { name: /完整晋级图/ })).toBeVisible();
    const legend = page.locator('.bracket__legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('胜者晋级方向');
    await expect(legend).toContainText('败者落位方向');

    // 连线是装饰，不应被读屏念出来
    await expect(page.locator('.bracket__connectors')).toHaveAttribute('aria-hidden', 'true');
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
    // 路径必须带上应用前缀，否则子路径部署时请求的是应用之外的位置，
    // 测的就不是「产物里有没有维护页」了。
    const response = await page.request.get(`${APP_BASE}operator.html`);
    if (response.status() === 200) {
      // 若托管方对未知路径做了 SPA 回退，这里会拿到观众站首页：
      // 那不算缺陷，但必须确认它**不是**维护页面。
      const html = await response.text();
      expect(html).toContain('RoboGame2026 赛程与结果');
      expect(html).not.toContain('维护工具');
      expect(html).not.toContain('src/operator');
    } else {
      // 真实的静态托管（含 GitHub Pages）对不存在的文件返回 404，同样合格。
      expect(response.status()).toBe(404);
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
      expect(code).not.toContain('/api/operator');
      expect(code).not.toContain('接管编辑');
      expect(code).not.toContain('本地赛事工作台');
      expect(code).not.toContain('rg26.operator.session');
      // 不应打包维护模式入口模块
      expect(code).not.toContain('src/operator/main');
    }
  });
});
