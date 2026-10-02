# RG26 体验升级与维护交接

## 权威资料与边界

本轮升级以 `docs/RoboGame2026赛程安排（暂定） (1).docx` 与 `docs/RoboGame2026 竞技组规则手册4_6.pdf` 为依据。根目录的旧赛程不能用于重新生成数据。具体规则、来源摘要与哈希见 [RULES.md](RULES.md)。

React、TypeScript、Vite、GitHub Pages 与公开 schema 1 保持不变。裁判确认规则与有理数排名公式保持不变。新赛程增加四场上午八强首轮，第三轮瑞士轮全部于首日晚间进行；上午赛果决定下午胜者组与败者组。

## 观众体验

- 四个 hash 主入口：总览 `/`、赛程 `/schedule`、晋级 `/progress`、队伍 `/teams`。既有 `/matches/:id`、`/teams/:id` 深链继续可直接刷新。
- 浅色赛事设计、统一 SVG 图标、手机底部导航、安全区与焦点样式。390×844 首屏能完整看到下一场比赛卡。桌面使用内容与摘要侧栏。
- 总览根据赛前、赛中、赛后展示安排、正在进行、关注队伍、最近结果和最终奖项。重要公告靠前，完整图保留入口。
- 赛程按当前安排时间分组，同一时刻并行展示；日期常驻，关注、当前定位、筛选面板和可移除筛选条件。
- 晋级默认当前阶段和轮次，瑞士轮按战绩组，决赛按六个轮次；排名默认简洁列，评分明细可展开。完整图通过 `view=journey` 进入；保留 `view=finals&mode=bracket` 兼容链接，支持阶段定位与队伍路径高亮。
- 队伍关注状态共享，保留本机历史关注。详情先展示下一次出场，排位赛跑图也计入。
- `effectiveStart` 统一使用 `revisedStart ?? plannedStart`；保留原计划和说明。30 秒共享时钟推进时间视图，但不自动改变比赛执行状态。
- 60 秒检查新快照，回到前台立即检查；失败保留旧数据。新结果显示变化摘要，不清空筛选、滚动或展开状态。

## 维护工作流与代码位置

启动、录入、更正、迁移、交接与故障恢复步骤见 [维护指南](operator-guide.md)。正常顺序为：

**连续录入 → 自动保存 → 累计变更 → 观众预览 → 确认发布 → 上线确认。**

| 职责 | 文件/目录 |
| --- | --- |
| 本地 API 与 Vite 同源工作台 | `scripts/operator-server.ts`、`scripts/operator/` |
| 会话、草稿、预览、任务契约 | `src/operator/contracts.ts` |
| 比赛队列与分场分局输入 | `src/operator/ResultWorkbench.tsx`、`FormDraftContext.tsx` |
| 排名、配对、公告、日程 | `src/operator/PlanningPanels.tsx` |
| 更正/重赛和下游保护 | `src/operator/result-edit.ts`、`src/domain/corrections.ts` |
| 共享公开预览 | `src/data/DataProvider.tsx` 的 `SnapshotProvider` |
| 共享 CLI 发布入口 | `scripts/publish.ts` |
| Windows 启动 | `start-operator.cmd`、`scripts/start-operator.mjs` |

服务只绑定 `127.0.0.1:5199`，直接读 `data/event.json`；`.local/operator` 保存原子写入的草稿、基础版本、未完成输入、操作记录和发布任务。公开构建不包含维护入口、API 实现、草稿或日志。Host、Origin、token 与单编辑会话限制所有写入；接管明确显示，版本冲突不覆盖旧草稿。

预览冻结 draftVersion/baseRevision/expectedHead，复用观众页面；不改正式文件、公开快照、暂存区或 HEAD。发布只在 `main`、配置的 `origin/main` 执行，只提交两份赛事数据文件。检查工作区和暂存区、快进同步与源版本；提交前失败恢复本次文件，提交后推送失败保留 SHA，重试只推送原提交。

任务持续保存阶段与错误。已提交后可继续录入下一批，发布时仍绑定冻结版本。公开站点返回的 `revision` 和 `sourceCommit` 同时匹配才标记“观众已可见”；Actions 状态仅为辅助信号。复用 Git 登录，代理仅作用于当前进程。

## 回归与交付

- 合成场景：`tests/fixtures/audience-scenarios.ts` 提供赛前、排位进行中、瑞士轮、BO3、赛后和改期；更正、重赛、离线、旧版本保护另有领域/浏览器测试。合成数据禁止写入正式源。
- 领域/模型/服务：`npm test`。发布服务测试使用临时 bare 远端和真实 Git，覆盖失败、重试、重启、并发、工作区保护和上线双字段检查。
- 观众浏览器：`npm run test:e2e`，Chromium 桌面/手机/平板与手机 WebKit。原有晋级图旋转、字体变化、卡片裁切和连线回归保留。
- 维护浏览器：`npx playwright test --config playwright.operator.config.ts`，独立临时仓库与端口，不修改公开 dist 或正式数据。
- 发布前：`npm run typecheck`、`npm run lint`、`npm run build`、`npm run check:integration`、`npm run check:robustness`；验证根路径与 `/RG26/`。
- 先在 `codex/experience-upgrade` 完成开发与验收，再合入 `main` 提交推送；远端 CI、Pages 和公开快照版本必须核实。最终验收结果与截图见 `docs/acceptance`。

历史修复的截图保留作为基线；`upgrade-*` 为此次升级验收截图。测试未通过或上线尚未匹配时，不得宣称发布完成。
