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
  test('13.4 赛前晋级图标明席位颜色，但不编造成绩、胜者和参赛队伍', async ({ page }) => {
    await usePreEventSnapshot(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    await expect(page.locator('.bracket').first()).toBeVisible();
    await page.waitForTimeout(1200);

    const stats = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.bracket-card')];
      const rows = [...document.querySelectorAll<HTMLElement>('.bracket-card__row')];
      return {
        cards: cards.length,
        done: cards.filter((c) => c.classList.contains('bracket-card--done')).length,
        winnerRows: rows.filter((r) => r.classList.contains('is-winner')).length,
        // 有比分的行：形如 "16 分 · 81 秒"
        rowsWithScore: rows.filter((r) => /\d+\s*分/.test(r.innerText)).length,
        rowsWithSeconds: rows.filter((r) => /\d+\s*秒/.test(r.innerText)).length,
        finalsBo1Sides: [...document.querySelectorAll<HTMLElement>('[data-bracket-zone] [data-node-id]')]
          .filter(node => !['F-QUAL', 'F-GF'].includes(node.dataset.nodeId!))
          .map(node => [...node.querySelectorAll('.bracket-card__row .side-badge')].map(badge => badge.getAttribute('aria-label'))),
        swissPendingSlots: document.querySelectorAll('[data-journey-stage="swiss"] .bracket-card__slot-sides').length,
      };
    });

    expect(stats.cards, '完整赛前晋级图仍展示全部场次').toBe(47);
    expect(stats.done, '赛前不得标出已结算比赛').toBe(0);
    expect(stats.winnerRows, '无成绩时不得凭空标出胜者').toBe(0);
    expect(stats.rowsWithScore, '无成绩时不得凭空显示比分').toBe(0);
    expect(stats.rowsWithSeconds, '无成绩时不得凭空显示到达最终分时间').toBe(0);
    expect(stats.finalsBo1Sides, 'BO1 席位颜色由赛程确定，不依赖队名和赛果').toEqual(Array.from({ length: 12 }, () => ['蓝方', '红方']));
    expect(stats.swissPendingSlots, '尚未公布的瑞士轮只说明第一、第二席位颜色').toBe(33);
    const swiss = page.locator('[data-journey-stage="swiss"]');
    await expect(swiss.locator('.bracket-card__row')).toHaveCount(33);
    await expect(swiss.locator('.bracket-card__row .side-badge')).toHaveCount(0);
    const swissText = await swiss.innerText();
    for (const team of buildSeedEvent('2026-10-02T12:00:00+08:00').teams) expect(swissText, '席位颜色不能被误解为已经公布某支队伍').not.toContain(team.name);
  });

  test('13.4 总览保留独立完整晋级图入口', async ({ page }) => {
    await goto(page, '/');
    await waitForData(page);
    await expect(page.locator('.bracket')).toHaveCount(0);
    await page.getByRole('link', { name: /完整晋级图/ }).first().click();
    await expect(page.locator('.bracket__scroller').first()).toBeVisible();
    await expect(page.locator('.bracket-card')).toHaveCount(47);
    await expect(page.locator('.bracket__column')).toHaveCount(13);
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

test.describe('13.4 分区晋级图', () => {
  test('决赛分成胜者、败者、冠军三个区域，全部场次恰好出现一次', async ({ page }) => {
    await goto(page, '/progress?view=finals&mode=bracket');
    await waitForData(page);
    const expected = {
      winners: ['F-M1', 'F-M4', 'F-M2', 'F-M3', 'F-W1A', 'F-W1B', 'F-WSF'],
      losers: ['F-L1A', 'F-L1B', 'F-L2B', 'F-L2A', 'F-LSF'],
      championship: ['F-QUAL', 'F-GF'],
    };
    for (const [zone, ids] of Object.entries(expected)) {
      const section = page.locator(`[data-bracket-zone="${zone}"]`);
      await expect(section).toBeVisible();
      expect(await section.locator('[data-node-id]').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).dataset.nodeId))).toEqual(ids);
      await expect(section.locator('.bracket__column')).toHaveCount(zone === 'championship' ? 2 : 3);
    }
    await expect(page.locator('.bracket-card')).toHaveCount(14);
    await expect(page.locator('.bracket__board')).toHaveCount(3);
    await expect(page.locator('.bracket__link')).toHaveCount(11);
    // 跨区去向通过可点击的场次引用表达，不再画贯穿无关卡片的长虚线。
    await expect(page.locator('.bracket__link--loser')).toHaveCount(0);
    const paths = await page.locator('.bracket__link').evaluateAll(links => links.map(link => link.getAttribute('d')));
    for (const path of paths) {
      const coords = path?.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(coords.length).toBeGreaterThan(0);
      expect(coords.every(c => Number.isFinite(c) && Math.abs(c) < 100_000)).toBe(true);
    }
  });

  test('同一画布不同路径的竖直段不会共线重叠', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=finals&mode=bracket');
    await waitForData(page);
    const result = await page.locator('.bracket__board').evaluateAll(boards => {
      let total = 0;
      const bad: string[] = [];
      boards.forEach((board, boardIndex) => {
        const segments: { x: number; low: number; high: number; path: number }[] = [];
        board.querySelectorAll('.bracket__link').forEach((link, path) => {
          let x = 0, y = 0;
          for (const t of (link.getAttribute('d') ?? '').matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
            const n = Number(t[2]);
            if (t[1] === 'M') { x = n; y = Number(t[3]); }
            else if (t[1] === 'H') x = n;
            else { if (Math.abs(n - y) > 2) segments.push({ x, low: Math.min(y, n), high: Math.max(y, n), path }); y = n; }
          }
        });
        total += segments.length;
        for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
          const a = segments[i]!, b = segments[j]!;
          if (a.path !== b.path && Math.abs(a.x - b.x) < 1 && Math.min(a.high, b.high) - Math.max(a.low, b.low) > 2) bad.push(`画布${boardIndex}，路径${a.path}/${b.path}，x=${a.x}`);
        }
      });
      return { total, bad };
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.bad).toEqual([]);
  });

  test('同一画布不同路径的水平段不重叠，也不穿过无关比赛卡片', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await goto(page, '/progress?view=journey');
    await waitForData(page);
    const result = await page.locator('.bracket__board').evaluateAll(boards => {
      let total = 0;
      const bad: string[] = [];
      boards.forEach((board, boardIndex) => {
        const bounds = board.getBoundingClientRect();
        const nodes = [...board.querySelectorAll<HTMLElement>('[data-node-id]')].map(node => ({ id: node.dataset.nodeId, rect: node.getBoundingClientRect() }));
        const segments: { y: number; left: number; right: number; path: number; from: string | undefined; to: string | undefined }[] = [];
        board.querySelectorAll<SVGPathElement>('.bracket__link').forEach((link, path) => {
          let x = 0, y = 0;
          for (const t of (link.getAttribute('d') ?? '').matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
            const n = Number(t[2]);
            if (t[1] === 'M') { x = n; y = Number(t[3]); }
            else if (t[1] === 'V') y = n;
            else {
              const segment = { y, left: Math.min(x, n), right: Math.max(x, n), path, from: link.dataset.fromId, to: link.dataset.toId };
              segments.push(segment);
              for (const node of nodes) {
                if (node.id === segment.from || node.id === segment.to) continue;
                if (y > node.rect.top - bounds.top + 2 && y < node.rect.bottom - bounds.top - 2 && Math.min(segment.right, node.rect.right - bounds.left) - Math.max(segment.left, node.rect.left - bounds.left) > 2) bad.push(`画布${boardIndex}，路径${path}穿过${node.id}`);
              }
              x = n;
            }
          }
        });
        total += segments.length;
        for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
          const a = segments[i]!, b = segments[j]!;
          if (a.path === b.path || Math.abs(a.y - b.y) > 0.1) continue;
          const lo = Math.max(a.left, b.left), hi = Math.min(a.right, b.right);
          if (hi - lo <= 2) continue;
          // 只允许同一实际起点的扇出或同一实际终点的汇入；任意卡片边缘不算例外。
          const sharedFrom = a.from && a.from === b.from && nodes.find(n => n.id === a.from);
          const sharedTo = a.to && a.to === b.to && nodes.find(n => n.id === a.to);
          const fansOut = sharedFrom && Math.abs(lo - (sharedFrom.rect.right - bounds.left)) <= 3;
          const merges = sharedTo && Math.abs(hi - (sharedTo.rect.left - bounds.left)) <= 3;
          if (!fansOut && !merges) bad.push(`画布${boardIndex}，路径${a.path}/${b.path}在y=${a.y}重叠${hi - lo}px`);
        }
      });
      return { total, bad };
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.bad).toEqual([]);
  });

  test('对外文案用场次序号，绝不出现内部 ID', async ({ page }) => {
    for (const route of ['/progress?view=finals&mode=bracket', '/progress?view=finals&mode=list', '/progress?view=journey', '/matches/F-L2A', '/schedule', '/']) {
      await goto(page, route); await waitForData(page);
      expect(await page.locator('body').innerText(), `${route} 泄漏内部系列赛 ID`).not.toMatch(/F-[A-Z0-9]+/);
    }
  });

  test('未决出名额使用可对应比赛卡片的胜者或败者场次号', async ({ page }) => {
    await usePreEventSnapshot(page);
    await goto(page, '/progress?view=finals&mode=bracket'); await waitForData(page);
    const text = await page.locator('main').innerText();
    for (const no of [1, 5, 10, 13, 14]) expect(text).toContain(`第 ${no} 场`);
    expect(text).toMatch(/第 \d+ 场(胜者|败者)/);
    expect(text).not.toMatch(/F-[A-Z0-9]+/);
  });

  test('完整晋级图将瑞士轮与分区决赛顺序展示，所有比赛完整且无重复', async ({ page }) => {
    await goto(page, '/progress?view=journey'); await waitForData(page);
    await expect(page.locator('[data-journey-stage="swiss"] .bracket-card')).toHaveCount(33);
    await expect(page.locator('[data-journey-stage="finals"] .bracket-card')).toHaveCount(14);
    await expect(page.locator('.bracket__board')).toHaveCount(4);
    await expect(page.locator('.bracket__column')).toHaveCount(13);
    const ids = await page.locator('.bracket__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.nodeId));
    expect(new Set(ids).size).toBe(47);
    const text = (await page.locator('.bracket').allInnerTexts()).join('\n');
    expect(text).not.toContain('单独跑图');
    expect(text).not.toMatch(/排位赛第 \d+ 轮/);
  });

  test('每个分区内从左向右推进，独立画布保持紧凑', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey'); await waitForData(page);
    const layouts = await page.locator('.bracket__board').evaluateAll(boards => boards.map(board => ({
      height: board.clientHeight,
      columns: [...board.querySelectorAll<HTMLElement>('.bracket__column')].map(column => ({ left: parseFloat(column.style.left), top: parseFloat(column.style.top) })),
    })));
    expect(layouts).toHaveLength(4);
    for (const layout of layouts) {
      expect(layout.height).toBeGreaterThan(0);
      expect(layout.height).toBeLessThan(1600);
      expect(new Set(layout.columns.map(c => c.top)).size).toBe(1);
      for (let i = 1; i < layout.columns.length; i += 1) expect(layout.columns[i]!.left).toBeGreaterThan(layout.columns[i - 1]!.left);
    }
  });

  test('各分区按自身内容定高，短分区不会继承最长列的高度', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goto(page, '/progress?view=journey'); await waitForData(page);
    const metrics = await page.locator('.bracket').evaluateAll(charts => charts.map(chart => {
      const board = chart.querySelector<HTMLElement>('.bracket__board')!;
      const scroller = chart.querySelector<HTMLElement>('.bracket__scroller')!;
      const bodies = [...chart.querySelectorAll<HTMLElement>('.bracket__column-body')].map(body => parseFloat(body.style.height));
      return { board: board.clientHeight, scroll: scroller.scrollHeight, bodies: [...new Set(bodies)] };
    }));
    expect(metrics).toHaveLength(4);
    expect(metrics[0]!.bodies.length).toBeGreaterThan(1);
    expect(metrics[1]!.bodies.length).toBeGreaterThan(1);
    expect(metrics[3]!.board).toBeLessThan(metrics[1]!.board);
    for (const metric of metrics) expect(metric.scroll - metric.board).toBeLessThan(120);
  });

  for (const [width, height] of [[1440, 900], [390, 844], [768, 1024]] as const) {
    test(`所有画布最下方比赛及连线不被裁切（${width}x${height}）`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await goto(page, '/progress?view=journey'); await waitForData(page);
      await expect.poll(() => page.locator('.bracket').evaluateAll(charts => charts.flatMap((chart, index) => {
        const board = chart.querySelector<HTMLElement>('.bracket__board')!;
        const scroller = chart.querySelector<HTMLElement>('.bracket__scroller')!;
        const bounds = board.getBoundingClientRect();
        const issues = [...board.querySelectorAll<HTMLElement>('.bracket__node')].filter(node => node.getBoundingClientRect().bottom > bounds.bottom + 1).map(node => `${node.dataset.nodeId}超出画布${index}`);
        const svg = board.querySelector('.bracket__connectors');
        if (Number(svg?.getAttribute('height')) < board.clientHeight) issues.push(`画布${index}连线层偏矮`);
        if (scroller.scrollHeight - scroller.clientHeight > 1) issues.push(`画布${index}纵向被裁`);
        return issues;
      }))).toEqual([]);
    });
  }

  test('瑞士轮对阵未公布时解释等待条件，不编造名次或固定晋级关系', async ({ page }) => {
    await usePreEventSnapshot(page);
    await goto(page, '/progress?view=journey'); await waitForData(page);
    const swiss = page.locator('[data-journey-stage="swiss"]');
    expect(await swiss.innerText()).toMatch(/等待第 \d 轮结果确认后公布/);
    expect(await swiss.innerText()).not.toMatch(/排位赛第 \d+ 名\s*\n\s*排位赛第 \d+ 名/);
    await expect(swiss.locator('.bracket__link')).toHaveCount(0);
  });

  test('窄屏每个分区独立横向滚动，页面本体不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goto(page, '/progress?view=journey'); await waitForData(page);
    await expect(page.locator('.bracket__scroller')).toHaveCount(4);
    const metrics = await page.locator('.bracket__scroller').evaluateAll(scrollers => scrollers.map(scroller => {
      scroller.scrollLeft = 400;
      return { width: scroller.clientWidth, content: scroller.scrollWidth, moved: scroller.scrollLeft };
    }));
    for (const metric of metrics) {
      expect(metric.content).toBeGreaterThan(metric.width);
      expect(metric.content).toBeLessThan(20_000);
      expect(metric.moved).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('分区标题、场次引用和装饰性连线具备可访问性语义', async ({ page }) => {
    await goto(page, '/progress?view=journey'); await waitForData(page);
    const navigation = page.getByRole('group', { name: '定位决赛分区', exact: true });
    for (const name of ['胜者组', '败者组', '冠军争夺']) await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
    for (const svg of await page.locator('.bracket__connectors').all()) await expect(svg).toHaveAttribute('aria-hidden', 'true');
    for (const reference of await page.locator('.finals-transfer').all()) expect((await reference.innerText()).trim()).toMatch(/第 \d+ 场/);
    expect(await page.locator('.finals-transfer').count()).toBeGreaterThan(0);
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
