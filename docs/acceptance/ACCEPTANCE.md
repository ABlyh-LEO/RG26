# 验收记录

对应 `docs/IMPLEMENTATION_PLAN.md` 第 13 节。记录**实际执行过的检查**、
所用环境，以及**未验证项**。

- 记录日期：2026-09-30
- Node：v24.12.0 · npm：11.8.0
- 浏览器内核：**Chromium（通过系统安装的 Microsoft Edge，channel=msedge）**
- 未使用 Playwright 自带浏览器（下载受网络限制，见「未验证项」）

---

## 1 自动化检查结果汇总

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | ✅ 通过（0 错误） |
| Lint | `npm run lint` | ✅ 通过（0 错误 0 警告） |
| 领域单元测试 | `npm run test` | ✅ **85/85 通过** |
| 数据校验 | `npm run validate:data` | ✅ 通过（0 错误、6 已知提示） |
| 生产构建 | `npm run build` | ✅ 通过 |
| 端到端（桌面） | `npm run test:e2e` | ✅ **22/22 通过** |
| 端到端（手机 + 平板） | `npm run test:e2e` | ✅ **44/44 通过** |
| 维护闭环集成 | `npm run check:integration` | ✅ 全部断言通过 |
| 截图与溢出检查 | `npm run screenshots` | ✅ 13 张，0 横向溢出 |

**端到端测试总计 66 项通过。**

### 构建产物指标

| 指标 | 实测 | 目标 | 结果 |
| --- | --- | --- | --- |
| 初始 JS（gzip） | **92.92 KB** | ≲ 200 KB | ✅ |
| 公开数据 | **116.3 KB** | ≲ 250 KB | ✅ |
| CSS（gzip） | 2.59 KB | — | ✅ |
| 公开产物含 `operator.html` | 否 | 必须为否 | ✅ |

---

## 2 第 13.1 节 领域算法用例（D01–D18）

全部实现为自动化测试，位于 `tests/domain/`。

| 编号 | 用例 | 测试文件 | 结果 |
| --- | --- | --- | --- |
| D01 | 原文简例：18/0 对 12/10 → A=50、B=40、P=45；O=70、R=55 | `scores.test.ts` | ✅ |
| D02 | 得分 >16、分差 >±10 时只在每场贡献中截断，原始值保留 | `scores.test.ts` | ✅ |
| D03 | 零分有效局记 360；无有效局 A/B/P=0、T=360；无对阵 O=0；指标均在 0–100 | `scores.test.ts` | ✅ |
| D04 | 弃权/行政中止：n 不增加，W/L、m、O 正确增加，无假 0 分 | `swiss.test.ts` | ✅ |
| D05 | 重赛只取最终有效 attempt；未确认 attempt 不计入 | `swiss.test.ts` | ✅ |
| D06 | 显示同为两位小数时仍按原始精度排序，并逐级比 P/T | `swiss.test.ts` | ✅ |
| D07 | 同一对手出现两次时按两次计入，不去重 | `swiss.test.ts` | ✅ |
| D08 | 3–0 后 W/L/P 保持，O/R 随历史对手变化；最终种子按 R5 决定 | `corrections.test.ts` | ✅ |
| D09 | R1 首尾配对严格；R2 起同组相邻；上一轮未确认时拒绝生成 | `swiss.test.ts` | ✅ |
| D10 | R2 完成公布 R3；前四场完成后次日四场不变，R4 仍不可生成 | `swiss.test.ts` + 集成检查 | ✅ |
| D11 | 全赛程 5 轮 33 场；最终战绩组人数 2/3/3/3/3/2 | `swiss.test.ts` | ✅ |
| D12 | 决赛映射：两场 L2 为交叉来源；完整推进出冠军/亚军/季军 | `finals.test.ts` | ✅ |
| D13 | BO3 2–0 有效 2 局、2–1 有效 3 局；2–0 第三局「不需要进行」；无重置 | `finals.test.ts` | ✅ |
| D14 | 更正已确认成绩：重算全体 O/R，已公布未开赛下游出现处置提示 | `corrections.test.ts` | ✅ |
| D15 | 更正前置胜者且下游已开赛：不迁移旧比分，保留记录并报冲突 | `finals.test.ts` + `corrections.test.ts` | ✅ |
| D16 | 缺积分、未知胜者、自我对阵、循环依赖、重复 ID 均给出可读错误 | `validation.test.ts` | ✅ |
| D17 | 三审排名与排位名次不同时，R1 与同分比较使用正式排位 | `swiss.test.ts` | ✅ |
| D18 | 退赛造成分组奇数时停止自动配对并报因，不擅自轮空 | `swiss.test.ts` | ✅ |

---

## 3 第 13.2 节 用户流程与发布

| # | 用例 | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 首屏找到下一场；搜索长队名、打开详情并分享 | e2e「1. 首屏…」 | ✅ |
| 2 | 排位赛同时两场可展示；展示组不出现在竞技排名 | e2e「2. 排位赛…」 | ✅ |
| 3 | 抽签未录入时不虚构演出队伍 | e2e「3. 展示组抽签…」 | ✅ |
| 4 | 两个标签页基于同一版本，第二份导入被基础版本拒绝 | 集成检查 §11 + `corrections` 测试 | ✅ |
| 5 | 未完成赛事可构建；无效结果被 CI 拒绝；部分完成不误判 | `validate:data` + `validation.test.ts` | ✅ |
| 6 | 手机停留详情时发布新数据，刷新不跳走且结果更新 | e2e「9. 队伍深链刷新」+ 仅 revision 变化才替换内容 | ✅ |
| 7 | 不兼容 schema / 损坏 JSON / 404 / 超时 / 无缓存 / localStorage 不可用 | e2e「健壮性」3 项 + `snapshot.ts` 容错 | ✅ |
| 8 | 根路径与仓库子路径都能读取资源、数据与深链 | `npm run check:subpath`（真实构建 + 浏览器验证） | ✅ |
| 9 | 已公开更正可追溯；回滚后观众可见 | `corrections.test.ts` + 操作手册 §12 | ✅ 逻辑 |
| 10 | 公开构建不可进入维护模式，不携带写入凭据或草稿 | e2e「公开构建不含…」+「产物界面代码检查」 | ✅ |

### base 路径验证

| 场景 | 结果 |
| --- | --- |
| `/` 根路径构建与预览 | ✅ 已验证（全部 e2e 与截图都跑在此配置上） |
| `/<repo>/` 子路径构建 | ✅ **已验证** —— `npm run check:subpath` |
| 深链刷新不 404 | ✅ 已验证（hash 路由，e2e「9. 队伍深链刷新」+ 子路径检查） |

> 子路径验证会真实构建、模拟 Pages 目录结构并启动静态服务器
> （未知路径返回 404，而非 SPA 回退），再用浏览器逐项断言。
> 详见 §6.5。

---

## 4 第 13.3 节 视觉与设备检查

### 宽度矩阵（页面本体无横向溢出）

| 宽度 | 结果 |
| --- | --- |
| 360px | ✅ 0px 溢出（7 条路由全部检查） |
| 390px | ✅ 0px 溢出 |
| 768px | ✅ 0px 溢出 |
| 1440px | ✅ 0px 溢出 |

检查的 7 条路由：`/`、`/schedule`、`/progress?view=qualification`、
`/progress?view=swiss`、`/progress?view=finals`、`/teams`、`/rules`。

**截图复核**：13 张截图额外确认溢出均为 **0px**（含决赛完整对阵图的横向滚动容器）。

### 其他检查

| 项目 | 结果 |
| --- | --- |
| 键盘焦点可见（Tab 后 outline 宽度非 0） | ✅ |
| 减少动画设置生效（transitionDuration < 0.01s） | ✅ |
| 状态不只靠颜色（徽章均有可见文字） | ✅ |
| 手机底部导航四项可用 | ✅ |
| 最长队名在 375px 仍完整显示且不挤出比分 | ✅ |

### 截图清单

位于 `docs/acceptance/screenshots/`：

| 文件 | 内容 |
| --- | --- |
| `01-overview-desktop.png` | 总览（桌面） |
| `02-overview-mobile.png` | 总览（手机） |
| `03-schedule-r3-crossday.png` | R3 跨日赛程（10/3，桌面） |
| `04-schedule-r3-day2-mobile.png` | R3 跨日赛程（10/4，手机） |
| `05-teams-long-names-mobile.png` | 长队名列表（手机） |
| `06-progress-qualification.png` | 排位赛视图（含出场安排与正式排名分离） |
| `07-progress-swiss.png` | 瑞士轮详情（桌面） |
| `08-progress-swiss-mobile.png` | 瑞士轮详情（手机） |
| `09-finals-bracket.png` | 完整决赛对阵图 |
| `10-finals-mobile-vertical.png` | 手机纵向决赛 |
| `11-team-detail-longname-mobile.png` | 最长队名队伍详情（手机） |
| `12-rules-desktop.png` | 规则页 |
| `13-match-detail.png` | 比赛详情 |

---

## 5 维护闭环演练（P6）

`npm run check:integration` 完整跑通并断言：

```
种子数据 → 录入排位赛 22 队正式排名
  → 生成并公布 R1（验证首尾配对 第1名 vs 第16名）
  → 录入 R1 全部 8 场 → 确认
  → 生成并公布 R2（验证组顺序 1-0×4、0-1×4）
  → 录入 R2 全部 8 场 → 确认
  → 一次性公布 R3 全部 8 场（验证组顺序 2-0×2、1-1×4、0-2×2）
  → 跨日锁定演练：完成当晚 4 场，断言次日 4 场参赛双方与时间槽不变
  → 断言 R3 未完成时 R4 被阻断
  → 完成 R3 → 确认 → 生成 R4（6 场，2-1×3、1-2×3）
  → 数据校验通过 → 排名可计算
  → 变更包基础版本冲突被拒绝（退出码 1，且说明不提供 force 覆盖）
```

**关键断言全部通过**，包括最关键的 R3 跨日锁定。

---

## 6 未验证项与已知限制

**必须诚实记录，不得当作已完成。**

### 6.1 已推送，但**尚未确认部署**

- **已推送**：`https://github.com/ABlyh-LEO/RG26`，`main` 分支
  commit `0ddbdc3ca8b0a7a0fc6ac5f8d765d2d61a364811`（已用 `git ls-remote` 核对远端一致）。
- **未确认**：本次会话中 GitHub Actions 的运行状态**未核实**。
  GitHub REST API 通过当前网络返回 403，无法读取 run 状态。
- **未确认**：Pages 是否已启用（Settings → Pages → Source 必须选 **GitHub Actions**）。
- **因此仍不能说「已上线」**，只能说「已推送，等待你在 Actions 页面确认」。

**你需要做的两件事**（详见 `docs/DEPLOYMENT.md` §3）：

1. 打开 <https://github.com/ABlyh-LEO/RG26/settings/pages>，
   **Source 选择 `GitHub Actions`**（若还没选）。
2. 打开 <https://github.com/ABlyh-LEO/RG26/actions>，确认
   `Deploy to GitHub Pages` 的 build 与 deploy 两个 job 都成功。
   若首次因未启用 Pages 而失败，启用后点 **Re-run all jobs** 即可。

成功后站点地址应为：<https://ablyh-leo.github.io/RG26/>

### 6.2 本机网络环境（影响推送与部署确认）

| 项目 | 实测情况 |
| --- | --- |
| SSH（`git@github.com:22`） | ❌ 连接超时（端口被阻断） |
| SSH over 443（`ssh.github.com:443`） | ⚠️ 可连通，但**密钥未授权**（`Permission denied (publickey)`） |
| HTTPS + 代理 `127.0.0.1:7890` | ✅ **可用**（`push` 成功；`ls-remote` 偶发 `SSL_ERROR_SYSCALL`，重试即成功） |
| GitHub REST API | ❌ 403（无法读取 Actions 状态） |

本仓库已设置 `http.proxy` / `https.proxy` 指向 `127.0.0.1:7890`，
因此后续 `push` / `pull` 无需额外参数。

> 若换到无代理的网络，可清除：`git config --unset http.proxy && git config --unset https.proxy`

### 6.3 WebKit / 真实设备未验证

- 本次 e2e 与截图全部运行在 **Chromium 内核（Microsoft Edge）**。
- **未运行 WebKit**：Playwright 浏览器下载受网络限制失败
  （`Failed to download Chrome for Testing`）。
- **未做真机验证**：没有 iOS Safari、Android Chrome 的实机测试。
- **未做现场网络验证**：比赛中场地的实际访问质量尚未测量。
- 影响：iOS 上的字体渲染、`env(safe-area-inset-bottom)` 安全区、
  滚动行为等**可能**与 Chromium 有差异，需实机确认。

复现命令（网络可用时）：

```bash
npx playwright install chromium webkit
npm run test:e2e          # 默认包含 mobile-webkit 项目
```

### 6.4 Lighthouse 未实测

- 目标：移动端生产构建 性能 ≥90、可访问性 ≥95。
- **尚未测量**，因此**不能声称达标**。
- 已测量的替代指标：JS gzip 92.92 KB、CSS gzip 2.59 KB、数据 116.3 KB。
- 测量方法：对 `npm run preview` 的移动端生产构建运行 Lighthouse，
  并注意**单次分数不等于现场速度保证**。

### 6.5 仓库子路径构建（已验证）

**已验证通过**，命令 `npm run check:subpath`（可重复执行，自动清理临时产物）。

该脚本完整复现 GitHub Pages 项目站形态并端到端验证：

1. 用 `VITE_BASE_PATH=/rg26-test-repo/` 真实构建
2. 把 `dist` 放到临时目录的 `/<repo>/` 下（模拟 Pages 目录结构）
3. 启动静态服务器（对未知路径**返回 404**，如实模拟 Pages，而非 SPA 回退）
4. 用真实浏览器验证

| 检查项 | 结果 |
| --- | --- |
| 首页在子路径加载、数据就绪 | ✅ |
| 所有资源与数据请求**走子路径**（非根路径） | ✅ |
| 队伍深链首次打开 | ✅ |
| **深链刷新不 404** | ✅ |
| 全部 7 条路由渲染 | ✅ |
| 无 4xx/5xx 响应 | ✅ |
| 无 pageerror / console error | ✅ |

顺带修复了一个真实缺陷：原先缺少 favicon，浏览器会自动请求
`/favicon.ico` 得到 404。已改为**内联 SVG 图标**，既消除该请求又不依赖外部文件。

实际部署地址将是 `https://ablyh-leo.github.io/RG26/`，
而 `deploy.yml` 用 `github.event.repository.name` 自动取到 `RG26`，
因此 base 会是 `/RG26/`，与上述验证的形态一致。

### 6.6 数据中的已知不确定项

这些是**如实标注的不确定**，不是缺陷：

| 项目 | 状态 |
| --- | --- |
| `沬日堡垒队` 首字（沬/沫） | `nameVerified: false`，界面标注「队名待核对」 |
| `我也要打rg吗，队` 的 `rg` 大小写与空格 | 同上 |
| `Rg小队` 的首字母大小写 | 同上 |
| 场地名称（A/B 场地） | `provisionalName: true`，界面标注 `*` 与「临时名称」 |
| 展示组决赛抽签顺序 | 未登记，页面显示「等待抽签」，不推测 |
| 赛程组共享文档地址 | `officialScheduleUrl: null`，记录在 `openItems` |

### 6.7 规则解释上的待确认点

- 「已登记对阵 `m`」是否含**仅公布但未开赛**的配对：
  本工具采用**不含**（见 `docs/RULES.md` §3.2）。
  若组委会有不同解释，应递增 `rules.version` 并调整。
- 排位赛两轮「最优成绩」的比较与同分规则：原文未提供，
  采用**人工录入裁判确认名次**，不自行排序。

---

## 7 结论

**可以交付的：**

- 可运行的完整源码（观众站 + 领域层 + 本地维护模式 + 严格 schema）
- 初始正式数据（真实队伍与完整时间槽，**所有未发生结果为空**，无演示比分）
- 85 个领域测试 + 66 个端到端测试，覆盖第 13.1/13.2/13.3 节
- 完整文档：README、RULES、OPERATOR_GUIDE、DEPLOYMENT
- CI 与部署工作流（含产物隔离检查）
- 本验收记录与 13 张截图

**尚未完成的：**

- 实际部署（需仓库与所有者）
- WebKit / 真机 / 现场网络验证
- Lighthouse 实测

**下一步取决于你的输入：**

1. 提供 GitHub 仓库与所有者 → 按 `docs/DEPLOYMENT.md` §3 部署
2. 确认三个待核对队名与场地名 → 更新 `data/event.json` 后重新构建
3. 现场测试后如访问质量不足 → 同一 `dist` 可迁移到其他静态托管
