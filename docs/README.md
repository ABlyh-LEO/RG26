# RG26 文档入口

现场维护请从[维护操作手册](OPERATOR_GUIDE.md)开始。当前日常流程是：**启动本地工作台 → 连续录入并保存草稿 → 核对累计变更 → 观众预览 → 确认发布 → 等待“观众已可见”**。JSON 导入导出和 CLI 用于交接、应急或自动化，不是日常更新的必经步骤。

## 当前文档

| 文档 | 使用场景 |
| --- | --- |
| [维护操作手册](OPERATOR_GUIDE.md) | 启动、录入、裁判确认、更正、草稿恢复、预览、发布与交接 |
| [部署说明](DEPLOYMENT.md) | GitHub Pages 配置、构建检查与部署排障 |
| [规则说明](RULES.md) | 当前赛程、赛制、红蓝方、排名口径与资料来源 |
| [全系统符合性检查报告（2026-10-03）](compliance-audit-2026-10-03.md) | 对照赛程手册与规则手册逐条核对赛制/算法（重点瑞士轮）、时间表与数据流程的结论 |
| [排位赛定榜门禁排查与修复计划](qualification-ranking-gate-plan.md) | 「确认成绩就自动定榜并断言晋级」缺陷的完整问题清单、逐条证据与修复设计（实施已完成） |
| [体验升级说明](EXPERIENCE_UPGRADE.md) | 观众端与维护端的实现结构、回归范围和开发交接 |

赛程以 [docs 中的新赛程](RoboGame2026赛程安排（暂定）%20(1).docx)为准，规则参考[竞技组规则手册 4_6](RoboGame2026%20竞技组规则手册4_6.pdf)。根目录旧赛程与 `reference/schedule-extracted.md` 是历史资料，不用于更新正式赛程。

**2026-10-02 最新确认：决赛 BO3 全系列不换边，第一席位蓝、第二席位红。** 此条用户确认优先于此前逐局换边的说明和截图；原始 DOCX/PDF 保留原件，未改写。完整口径见[红蓝方归属](RULES.md#red-blue-sides)。

## 验收证据

- [界面、交互与更新流程升级](acceptance/2026-10-02-experience-upgrade.md)：升级范围、本地检查、截图及对应发布记录。
- [排位赛定榜门禁与「当前排行」](acceptance/2026-10-03-qualification-ranking-gate.md)：修复“确认一组成绩就断言晋级”的缺陷，含门禁口径、回归范围与未验证项。
- [展示组「单独演出」误报自我对阵的修复](acceptance/2026-10-03-showcase-performance.md)：展示组不再被当成两队比赛，抽签后可直接发布。
- [收尾时段时间重合修复](acceptance/2026-10-03-final-block-times.md)：对照赛程手册把两组 BO3 与表演赛定死为 16:35–17:05 / 17:05–17:35 / 17:35–17:50，并加校验与手册对照测试。
- [瑞士轮配对修正](acceptance/2026-10-03-swiss-pairing-manual.md)：R1 改前后两半对位、R2 起改组内首尾，与赛程手册一致。
- [瑞士轮对阵人工微调](acceptance/2026-10-03-swiss-pairing-adjustment.md)：组委会因特殊情况调整实际对阵（交换席位、结构校验、调整原因留痕、已公布未开赛可重发）。
- [特殊赛果验证：0:0、弃权、判负](acceptance/2026-10-03-special-results.md)：三类特殊情形的处理结论、录入口径提示与已知限制。
- [开赛前最终全量检查](acceptance/2026-10-03-final-preflight.md)：赛前两小时的全量审查结论（GO）、修复项与开赛操作清单。
- [全局比赛编号](acceptance/2026-10-03-match-numbers.md)：排位赛 1–44、瑞士轮 45–77、决赛 78–91 的编号方案、显示位置与回归测试。
- [部署门禁假红修复](acceptance/2026-10-03-deploy-gate-data-states.md)：读正式数据的 e2e 必须与数据状态无关，附"赛季末快照"压力测试方法。
- [维护工作台验收](acceptance/operator-upgrade.md)：草稿、预览隔离、发布故障恢复与交接。
- [BO3 固定红蓝方](acceptance/2026-10-02-bo3-fixed-sides.md)：当前规则、实现范围及最新回归与截图。
- [晋级图汇入连线与红蓝方](acceptance/2026-10-02-bracket-junctions.md)：此前连线修复；其中旧 BO3 颜色说明和截图已被最新约定取代。
- [晋级图结构调整](acceptance/2026-10-02-bracket-clarity.md)、[CI 与移动端修复](acceptance/2026-10-02-ci-mobile.md)：此前专项修复记录。

验收记录只说明对应提交当时实际执行的检查，不替代当前操作手册。

## 历史记录

[初版实施计划](IMPLEMENTATION_PLAN.md)与[初版验收记录](acceptance/ACCEPTANCE.md)保留项目演进过程。两者中的旧赛程、旧页签和“导出 JSON 后执行发布命令”等操作已经过时；日常维护统一按[维护操作手册](OPERATOR_GUIDE.md)执行。旧路径 [operator-guide.md](operator-guide.md)仅作为兼容入口。
