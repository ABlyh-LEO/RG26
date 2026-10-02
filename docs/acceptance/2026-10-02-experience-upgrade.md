# RG26 界面、交互与发布流程升级验收

## 资料和数据

使用 `docs/RoboGame2026赛程安排（暂定） (1).docx` 与 `docs/RoboGame2026 竞技组规则手册4_6.pdf`；根目录旧赛程没有用于生成此次数据。完整 SHA-256 和规则核对见 [RULES.md](../RULES.md)。

正式源保留原有队伍、排位赛跑图、公告及尚未录入的比赛结果。按新赛程调整时间，补齐 10 月 4 日上午四场八强首轮，并把下午胜败者组连接到上午结果。竞技决赛现为 12 场 BO1 和 2 组 BO3；完整晋级图共 47 场、11 列。没有把验收用的合成比分写入正式数据。

公开 schema 仍为 1，裁判胜者确认、排名公式和更正下游保护保留。数据内容 revision 为 `f8bd0d619a9bcb01c4833076db3ba0af`；实际部署的 sourceCommit 由 CI 从提交读取。

## 本地验收

环境：Windows、Node 24.12.0，Playwright 自带 Chromium 153 和 WebKit 26.6。没有跳过 WebKit，也未以系统 Edge 替代。测试范围包括：

| 检查 | 结果与范围 |
| --- | --- |
| 类型检查 / ESLint | 通过 |
| 单元测试 | 265 项通过；领域、观众模型、静态服务、维护更正、临时 Git 发布、代理、变更摘要与 Pages 版本验证 |
| Chromium 观众端 | 桌面、手机、平板共 198 项通过 |
| WebKit 观众端 | 66 个用例已覆盖通过：全量首轮 56 项通过，修复后失败项及新增用例 11/11 复测通过（含一项重复） |
| 维护端 | Chromium 与 WebKit 各 8 项，共 16 项连续通过，0 重试 |
| 全赛季集成 | 排位赛 → 五轮瑞士轮 → 上午八强 → 下午双败 → BO3 全流程通过 |
| 健壮性 | 129 项通过，覆盖更正、重赛、发布校验与读取失败 |
| 项目子路径 | `/RG26/` 独立构建，所有路由、资源、数据与 hash 深链刷新通过；无失败请求和运行时错误 |

观众端回归包含 360、390、768、1440px 页面溢出检查，横竖屏与字体变化后的大图连线、列高和裁切检查，六个赛事阶段、原时间与跨日改期、关注跨页面同步、返回筛选/滚动位置以及增量刷新。

WebKit 回归实际发现并修复了筛选弹层关闭后的焦点恢复，以及完整图远距离平滑滚动中断的问题。另有初始化耗时引起的等待超时：统一等待真实数据就绪后，相关用例复测通过。比分、排名、焦点和滚动位置仍使用具体断言；没有通过跳过 WebKit 或仅等待页面外壳规避检查。远端 Linux 的 CI 与 Pages 工作流随后均重新运行全部四个观众项目（264 项）及维护端两个项目（16 项），全部通过。

维护端使用独立临时仓库和 bare 远端，实际创建提交和推送；测试重复发布、失败后重推相同 SHA、服务重启恢复、非快进拒绝和无关文件保护。预览逐项比对正式源、公开快照、HEAD 和暂存区，确认没有副作用。旧草稿迁移、未完成输入交接及当前 Windows 浏览器下载环境说明见 [维护端验收](operator-upgrade.md)。

## 截图

升级前基线保留在 [此前 CI 与移动端修复验收](2026-10-02-ci-mobile.md)。本次截图均保存在 `screenshots/upgrade-*`，测试比分属于合成场景：

- [观众首页 · 手机](screenshots/upgrade-home-mobile.png)、[桌面](screenshots/upgrade-home-desktop.png)
- [排位进行中](screenshots/upgrade-qualification-mobile.png)、[瑞士轮](screenshots/upgrade-swiss-mobile.png)、[BO3 详情](screenshots/upgrade-bo3-mobile.png)
- [赛后结果](screenshots/upgrade-after-mobile.png)、[改期](screenshots/upgrade-rescheduled-mobile.png)
- [赛程筛选](screenshots/upgrade-schedule-mobile.png)、[队伍详情](screenshots/upgrade-team-mobile.png)
- [晋级轮次 · 手机](screenshots/upgrade-progress-rounds-mobile.png)、[完整图 · 手机](screenshots/upgrade-progress-journey-mobile.png)、[完整图 · 桌面](screenshots/upgrade-progress-journey-desktop.png)
- [赛事工作台](screenshots/upgrade-operator-workbench.png)、[观众预览与累计变更](screenshots/upgrade-operator-preview.png)、[发布任务](screenshots/upgrade-operator-published.png)
- 真实 GitHub Pages：[线上手机首屏](screenshots/upgrade-online-mobile.png)、[线上桌面](screenshots/upgrade-online-desktop.png)

## 发布验收

开发分支为 `codex/experience-upgrade`，完成检查后快进合入 `main` 并推送到 `origin/main`。CI 检查根路径，Pages 构建以 `/RG26/` 运行完整观众及维护端测试；公开产物排除维护入口、API、草稿和日志。

代码提交 `b4eb00bfbcf38debec261ef39459b588dcf0d2a3` 已快进合入并推送到 `origin/main`。以下真实运行均关联该提交：

- [CI #27](https://github.com/ABlyh-LEO/RG26/actions/runs/36990477785)：成功，5 分 8 秒。
- [Pages #22](https://github.com/ABlyh-LEO/RG26/actions/runs/36990477829)：成功，5 分 11 秒。
- [部署详情](https://github.com/ABlyh-LEO/RG26/actions/runs/36990477829/job/110786753591)：公开版本核验成功，2026-10-02 17:38:43（北京时间）完成。

真实站点 [https://ablyh-leo.github.io/RG26/](https://ablyh-leo.github.io/RG26/) 的快照已核对：

```text
revision     = f8bd0d619a9bcb01c4833076db3ba0af
sourceCommit = b4eb00bfbcf38debec261ef39459b588dcf0d2a3
```

独立 Chromium 浏览器直接访问线上站点，未注入测试数据：390×844 首页首张比赛卡完整可见，底边为 494px；360、390、768、1440px 无页面横向溢出；队伍 hash 深链刷新成功；完整晋级图 47 张比赛卡；无运行时错误。上面的两张线上截图来自这次实际访问。

只有公开快照的 revision 与 sourceCommit 同时匹配本次目标，才报告“观众已可见”。部署验证脚本不会以“首页能访问”替代版本核对。本验收记录后续单独提交，仅补充证据，不改变这次已核验的运行代码或赛事数据。

使用方式和故障恢复见 [维护操作手册](../OPERATOR_GUIDE.md)，架构与交接说明见 [升级说明](../EXPERIENCE_UPGRADE.md)。
