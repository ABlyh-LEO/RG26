# 决赛汇入线修复与红蓝方标注

用户截图指出，第 1／4 场进入第 7 场、第 2／3 场进入第 8 场，以及第 7／8 场进入第 11 场时仍有十字交叉。上一轮分区改版保留的独立路径避让算法，将同一目标的第二个终点向上挪动，同时使用不同竖直车道，导致分支在入卡前交叉。原测试只检测共线重叠，未检测垂直线与水平线的交叉。

本次仅对决赛分区中的相邻列胜者连线启用树形汇合：同一比赛的来源分支使用同一通道中心与同一目标中心。11 条依赖及其来源、目标 ID 都保留，瑞士轮的独立路径算法不变。透明度改为作用于整个 SVG，避免共同末端被重复绘制得更深。

按用户追加要求，晋级图同时显示红蓝方：决赛 BO1 的席位即使队伍待定也标明蓝／红；已公布瑞士轮把颜色标在真实队伍旁，未公布时仅说明第一、第二席位的颜色规则。BO3 用逐局表区分上、下方队伍，第 1／3 局蓝红、第 2 局红蓝；2:0 后第三局标免赛，不显示不存在的出场颜色。颜色由现有 `sidesForFinals`、`sidesForSwiss` 和 `sidesForSeriesGame` 推出，没有修改赛制。

新增检测直接读取浏览器实测路径和卡片坐标，覆盖十字交叉、端点偏移、错误共线及多余折返。检测器自证用例区分正常汇合、目标被长卡片下推后的共用树干和错误交叉。旧版测试已明确失败，报告捕获截图中的三处交叉；修复后通过。

验证记录：

- 类型检查、Lint 和全部 280 项单元测试通过，其中晋级／红蓝规则及几何检测器覆盖 68 项。
- 桌面、手机和平板 Chromium 全部 237 项观众测试通过。
- 加入红蓝标注后，WebKit 的交叉检测、红蓝方、旋转、字体放大、刷新与关联定位共 15 项回归通过。
- 赛前、BO3 和赛后分别检查 360／390／768／1440px；额外检查横竖屏、横滑、22px 字体及赛果刷新。
- 根路径观众测试与 `/RG26/` 子路径检查通过，深链、资源、数据读取与公开产物隔离正常。

Windows WebKit 在字体变化与快照刷新后存在超过默认 5 秒的调度延迟；单独记录每条端点坐标，确认更新完成后偏差精确归零。相关测试等待目标 revision 响应，并给予布局有界的 15 秒收敛时间；未放宽交叉检测或坐标容差。

修复后实测截图：

- [桌面胜者组](screenshots/bracket-junctions/winners-desktop.png)
- [桌面败者组](screenshots/bracket-junctions/losers-desktop.png)
- [手机胜者组](screenshots/bracket-junctions/winners-mobile.png)
- [手机败者组](screenshots/bracket-junctions/losers-mobile.png)
- [桌面 BO3 逐局红蓝方](screenshots/bracket-junctions/championship-desktop.png)
- [手机 BO3 逐局红蓝方](screenshots/bracket-junctions/championship-mobile.png)

开发分支：`codex/bracket-junctions`。验收后合入 `main` 并推送，最终交付核验 CI、Pages 和公开快照的 `sourceCommit`。
