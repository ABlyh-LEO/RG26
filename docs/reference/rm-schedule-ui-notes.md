# rm-schedule-ui 设计参考笔记

来源：<https://github.com/scutrobotlab/rm-schedule-ui>（Apache-2.0，已 clone 到本机临时目录阅读）
用途：为 RoboGame2026 的「晋级页」改版提供参考。**只借鉴设计思路，不复制代码。**

## 它解决的问题

原文说得很清楚：瑞士轮改制的核心痛点是「下一轮对阵不仅取决于当前胜负，
还与实时排名、对手分及编排规则相关。传统赛程表难以同时表达
**已确定赛果**、**尚未确定的席位来源**、**晋级与淘汰路线**」。

这正好对应我们现在的短板：我用的是**卡片列表**，能表达单场信息，
但看不出"这两场胜者会在哪一场相遇"。

## 两套 UI，按设备分流

| | 经典版 | 移动端焕新版（Bracket） |
| --- | --- | --- |
| 形态 | 关系图（relation-graph），自由力导向 | **列式**：列为阶段，卡片纵向堆叠 |
| 面向 | 桌面、直播、图片导出 | 手机、触摸 |
| 默认视野 | 全图 | **默认两列**（看清一条晋级路线） |
| 缩放 | 画布缩放 | **一至六列连续语义缩放** |

设备判定（`utils/mobile.ts`）：
- UA 匹配移动端 **且** 有触控信号（`pointer: coarse` / `hover: none` / `maxTouchPoints`）
- 或 UA 移动端 **且** 窄屏（≤767px）
- **一旦判定为移动端就粘滞**，旋转/缩放不切回经典版
- 首屏 viewport 可能滞后，所以在 `[0,50,100,250,500,1000]ms` 反复重判，
  允许挂载后再"升级"到 Bracket，无需整页刷新

## 核心：列式 Bracket

### 数据模型
```
BracketViewModel {
  partType: 'roundrobin' | 'knockout' | ...
  columns: BracketColumn[]     // index, x, items[]
  connections: BracketConnection[]  // fromNodeId -> toNodeId, offsetX
}
```
关键：**列 = 阶段**（R1…R5、八强、半决赛、决赛），**节点 = 一场比赛**，
**连线 = 晋级流向**。这正好是我们已有的 winner/loser 依赖图。

### 淘汰树纵向布局（`bracket_tree_layout.ts`）
算法很简洁，值得直接借鉴思路：

```
按列从左到右：
  对每个节点，找它在**上一列**的 feeder（最多两个）
  若有两个 feeder：top = 两者中心的中点 - 自身高度/2
  若只有一个：     top = 该 feeder 中心 - 自身高度/2
  若没有：         top = cursor（顺序堆叠）
  同列不重叠：top < cursor 时下推
  cursor = bottom + gap
```

要点：
- **只用已有连线**，不猜父子关系
- 高度是**实测**的（`el.offsetHeight`），不是估算 —— 因为队名可能两行
- `resolveParents` 优先取上一列的 feeder；取不满两个再往更左侧找已布局节点
- `pickAdjacentPair`：feeder 多于两个时，取**中心距最近**的一对
- `shiftLayoutToAnchor`：锚点列（当前视口最左列）节点数 ≤2 时整树顶对齐到 0，
  节点多时不动，避免滑列时整棵树上下抽动

### 连线（`BracketConnectors.vue`）
- **绝对定位的 SVG 覆盖在网格之上**（`pointer-events: none`, `z-index: 0`）
- 用 `getBoundingClientRect()` 实测节点位置，而不是自己算坐标
- 路径：右侧节点比左侧靠右足够多时走直角折线
  `M x1 y1 H midX V y2 H x2`；否则用三次贝塞尔
- `ResizeObserver` + `rAF` 节流重算
- 有 `tracking` 模式：每帧 rAF 直接写 DOM 的 `d` 属性，
  与卡片的 CSS transition 同帧跟手（避免连线滞后于卡片）

### 语义缩放 / 密度（`bracket_density.ts`）
不是简单缩放页面尺寸，而是**按可见列数重新决定信息优先级**：

| 可见列数 | 密度 | 显示 |
| --- | --- | --- |
| ≤2 | comfortable | 队名、比分、席位来源、类型标签、支持率 |
| ≤4 | normal | 收缩字号/内边距 |
| ≥5 | compact | 隐藏低优先级标签，缩短比赛标题与席位来源 |

- 收缩用 **CSS 变量传进度值**（`--bracket-compact-progress` 等），
  在 CSS 里做连续插值，而不是 JS 切成三档
- 横向拖动会累积浮点误差（2.999999），
  `normalizeBracketVisibleSpan` 在计算密度前吸附到整数，避免误判档位
- **纵向对阵与席位永不截断** —— 只缩字号和内边距

## 可以直接用在我们项目上的部分

我们的 `FinalsResolution` 已经算出了：
- 每场系列赛的 `slots`（resolved / pending / conflict）
- winner / loser 依赖关系
- `FINALS_MATCH_ORDER`（拓扑序）

所以转成 `columns + connections` 是**纯映射**，不需要改领域层：

```
列：[八强败者组首轮 + 八强胜者组] → [败者组第二轮] → [半决赛] → [名额争夺战/总决赛]
连线：F-L1A.winner -> F-L2B ; F-W1A.loser -> F-L2A ; ...
```

瑞士轮同理：R1 → R2 → R3 → R4 → R5 五列，
连线用"同队跨轮次"关联（队伍在 R1 的位置连到它在 R2 的位置）。

## 与我当前实现的差距

| | 当前 | 参考 |
| --- | --- | --- |
| 决赛图 | 5 列 flex 布局，**没有连线** | 列 + SVG 连线，纵向按父子关系定位 |
| 瑞士轮 | 每轮一张卡片的列表 | 未做（他们只做淘汰赛的树） |
| 移动端 | 同一套布局，靠 CSS 响应式 | 独立的两列视图 + 拖拽缩放 |
| 席位来源 | 文字（"F-W1A 败者"） | 文字 + 图形化占位 |

## 不打算照搬的

- relation-graph 力导向图（依赖重，我们要轻量静态）
- 拖拽缩放 / 松手吸附（复杂，且我们的阶段数少，横滚够用）
- Vuetify / ECharts / Pinia（我们的技术栈不同）
