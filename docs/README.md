# RG26 文档入口

现场维护请从[维护操作手册](OPERATOR_GUIDE.md)开始。当前日常流程是：**启动本地工作台 → 连续录入并保存草稿 → 核对累计变更 → 观众预览 → 确认发布 → 等待“观众已可见”**。JSON 导入导出和 CLI 用于交接、应急或自动化，不是日常更新的必经步骤。

## 当前文档

| 文档 | 使用场景 |
| --- | --- |
| [维护操作手册](OPERATOR_GUIDE.md) | 启动、录入、裁判确认、更正、草稿恢复、预览、发布与交接 |
| [部署说明](DEPLOYMENT.md) | GitHub Pages 配置、构建检查与部署排障 |
| [规则说明](RULES.md) | 当前赛程、赛制、红蓝方、排名口径与资料来源 |
| [体验升级说明](EXPERIENCE_UPGRADE.md) | 观众端与维护端的实现结构、回归范围和开发交接 |

赛程以 [docs 中的新赛程](RoboGame2026赛程安排（暂定）%20(1).docx)为准，规则参考[竞技组规则手册 4_6](RoboGame2026%20竞技组规则手册4_6.pdf)。根目录旧赛程与 `reference/schedule-extracted.md` 是历史资料，不用于更新正式赛程。

## 验收证据

- [界面、交互与更新流程升级](acceptance/2026-10-02-experience-upgrade.md)：升级范围、本地检查、截图及对应发布记录。
- [维护工作台验收](acceptance/operator-upgrade.md)：草稿、预览隔离、发布故障恢复与交接。
- [晋级图汇入连线与红蓝方](acceptance/2026-10-02-bracket-junctions.md)：最新晋级图专项回归与截图。
- [晋级图结构调整](acceptance/2026-10-02-bracket-clarity.md)、[CI 与移动端修复](acceptance/2026-10-02-ci-mobile.md)：此前专项修复记录。

验收记录只说明对应提交当时实际执行的检查，不替代当前操作手册。

## 历史记录

[初版实施计划](IMPLEMENTATION_PLAN.md)与[初版验收记录](acceptance/ACCEPTANCE.md)保留项目演进过程。两者中的旧赛程、旧页签和“导出 JSON 后执行发布命令”等操作已经过时；日常维护统一按[维护操作手册](OPERATOR_GUIDE.md)执行。旧路径 [operator-guide.md](operator-guide.md)仅作为兼容入口。
