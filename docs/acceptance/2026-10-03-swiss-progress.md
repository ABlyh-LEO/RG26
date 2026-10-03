# 瑞士轮晋级呈现优化验收

本次统一瑞士轮页签与完整晋级图中的瑞士轮部分，提供晋级名单、五轮九组全景、实际对阵和单队历程。本文记录实现阶段的本地验收；正式上线以对应提交的 GitHub Actions 和公开快照 `sourceCommit`、`revision` 核验为准。改造未修改正式赛事源；生产快照由发布工作流从正式源生成。

## 最终行为

- 顶部显示已晋级、仍在争夺、已淘汰的数量与可切换名单；三胜只确认八强资格，不提前赋予八强种子名次。
- 全景中的节点表示进入该轮时的战绩，短箭头解释常规胜负去向，三胜/三负终点就近标注。点击节点打开下方实际对阵，33 场均可访问。
- 两个入口共用 `SwissProgress` 与纯派生 `buildSwissPresentation`。比赛详情分列队名、红蓝方、积分、用时、赛前/赛后战绩与晋级条件；参考评分默认折叠。
- 历史组名单来自已公布的实际参赛快照，参考评分只采用此前轮次的有效确认结果。本轮比赛结束后，原组名单与赛前战绩保持稳定。
- 选队只高亮真实参加的组，独立历程展示实际对手、胜负和战绩。跨组调整单独提示，晋级条件按双方真实战绩计算，修订说明保留。
- 未公布或已作废的轮次只显示预留场次、公布依赖和席位颜色规则；残留的候选双方与赛果不会成为已公布对阵。临时赛果、旧重赛记录不累计晋级。
- 小于 768px 默认单轮查看，主动打开全景时定位所选轮次。轮次、组选、队伍深链兼容；刷新保留筛选、评分展开及滚动位置。
- 决赛仍使用三个画布、14 个比赛节点及原有真实依赖。

## 测试数据与自动检查

新增独立合成场景 `swiss-r4`：R1–R3 已完成、R4 已公布、R5 待公布，结果为 **2 队晋级、12 队争夺、2 队淘汰**，R3 带组委会修订说明。通过浏览器请求拦截注入，未写入正式赛事数据。读取本次正式源也得到同一状态。

- `npm run typecheck`、`npm run lint`：通过。
- `npm run validate:data`：通过。
- `npm run build:only`：通过，生成本地生产预览。
- 完整 Vitest：**29 个文件、438 项通过**。新增模型用例涵盖历史名单稳定、正式名单门禁、跨组调整、暂定结果、弃权、重赛、更正、draft/superseded 隐藏、完整赛程与轮次选择。
- Chromium 桌面、手机、平板各 **94 项相关端到端用例**完成验证，去重共 **282 项**。每设备包含 74 项晋级相关用例（`app`、`bracket-crossings`、`bracket-mobile`、`bracket-sides`、`finals-bracket`、`progress-refresh`、`swiss-adjustment`、`swiss-progress`），以及 `audience-refresh`、`no-runtime-errors` 的 20 项跨页面回归。旧有等待文案断言已按实际公布依赖修正后复核通过。
- Mobile WebKit 的 **6 项瑞士轮核心交互**以单 worker 全部通过。尝试整套 74 项时，部分既有页面在加载数据阶段超过默认 30 秒，已中止整轮；不声明全部 WebKit 回归通过，未放宽全局超时。
- 最终字体修复后，同一手机用例在三个 Chromium 项目与 Mobile WebKit 共 **4 次复核通过**，不重复计入上述覆盖数量。

测试使用本地生产服务 `http://127.0.0.1:4173/` 和已安装的 Playwright Chromium/WebKit。浏览器验证配置 `E2E_NO_WEBSERVER=1`、`E2E_SKIP_BUILD=1`，避免重复构建。完整截图检查记录见 [checks.json](screenshots/swiss-progress/checks.json)。

## 视觉与交互检查

检查 360、390、768、1440px，以及手机横竖屏、全景横滑、长队名、键盘 Enter/Space 选组和赛果刷新。普通字号下页面横向溢出为 0，长队名完整换行，规则箭头抽样未穿越节点。

文字实际放大 200% 的检查发现全局 `.segmented` 样式覆盖了手机轮次网格，导致轮次条局部横向溢出。已提升瑞士轮容器选择器优先级并允许状态文字换行，补入手机回归用例。最终构建复核轮次条内部溢出为 0，R1–R5 完整显示，R5 可点击；全部截图均已重新生成。

局部截图为避免固定全局导航遮挡，仅在拍摄期间隐藏全局页头/底栏；全页截图保留实际导航。

| 场景 | 截图 |
| --- | --- |
| 桌面五轮全景 | [全景](screenshots/swiss-progress/01-desktop-overview.png) |
| 桌面完整页面 | [完整页面](screenshots/swiss-progress/02-desktop-full.png) |
| 实际队伍历程 | [桌面历程](screenshots/swiss-progress/03-desktop-team-journey.png)、[手机历程](screenshots/swiss-progress/10-mobile-team-journey.png) |
| 未公布的 R5 | [等待公布](screenshots/swiss-progress/05-desktop-r5-pending.png) |
| 手机默认单轮 | [390px 单轮](screenshots/swiss-progress/07-mobile-390-round.png) |
| 手机全景 | [横向全景](screenshots/swiss-progress/08-mobile-390-overview.png) |
| 长队名 | [完整换行](screenshots/swiss-progress/15-mobile-long-name-card.png) |
| 文字放大 200% | [手机轮次条](screenshots/swiss-progress/16-mobile-font-200-percent-round.png) |
