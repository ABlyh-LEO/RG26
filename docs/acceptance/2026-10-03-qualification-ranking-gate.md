# 2026-10-03 排位赛定榜门禁与「当前排行」验收

## 用户报告与范围

> “排位赛似乎一旦确定了一组的成绩，就会自动认为排名有效，断言一些队伍晋级一些队伍淘汰，这显然是不合理的。”

排查确认该问题成立，并按[排查与修复计划](../qualification-ranking-gate-plan.md)分三阶段修复。本页记录**实际执行过的检查**、设计上做的两处必要细化，以及未验证项。

## 根因

`applyQualificationAutoRanking`（`src/operator/draft.ts`）在**每确认一条跑图成绩**后都会被 `proposeResult` 隐式调用，并无条件写入 `status: 'confirmed'` + `publicationStatus: 'published'`。而 `computeQualificationRanking` 会为全部 22 支竞技组队伍产出条目，于是只确认 1 条成绩就得到一份“完整”的 1–22 名。

更隐蔽的是：只有 1 条可比成绩时，排序比较函数几乎全部返回 0，JS 稳定排序保留输入顺序，而该顺序恰好等于三审排名顺序——**假名次看起来毫无破绽**。同一份假名次还会：

- 让观众端名次表对每支队伍断言「晋级十六强 / 优秀奖」；
- 让队伍卡片与详情页显示「排位赛正式名次 第 N 名」；
- 通过 `qualifiedTeamIds` 反向决定瑞士轮 16 强名单（另有 6 支队从战绩表消失）；
- 让 R1 生成门禁自我通过（门禁校验的“前 16 名”与参赛名单同源）。

## 修复内容

### 阶段一：止血（`ac2fbd8`）

- 成绩录入**不再触发定榜**；定榜改为显式动作 `confirmQualificationRanking`，先判定后写入。
- 新增领域模块 `qualification-completeness`：
  - `assessQualificationCompleteness`：定榜前每支竞技组队伍都必须有**已确认且积分可比较**的成绩；
  - `officialQualificationRanking`：正式名次 = 已确认 且（成绩完整 **或** 有人为来源）。
- 观众端三态展示：已定榜 → 正式排名；未定榜但有成绩 → **当前排行**（实时、未确认、不作为晋级依据、无晋级状态列、逐行标注无成绩／仅一轮／并列）；无成绩 → 沿用空状态。
- `qualifiedTeamIds` 收紧为“只有正式名次”，新增 `displayPoolTeamIds` 承担赛前展示；`deriveExtras` 只在正式名次成立时结算优秀奖。
- R1 门禁升级；校验层新增 `ranking-confirmed-incomplete` 阻断发布；更正影响面改为比较实时排行并提示重新定榜。

### 阶段二：可审计（`3212f78`）

- 公开 schema 增加**可选**字段（`.nullable().default(null)`，旧快照无需迁移）：
  `missingTeamIds` / `partialTeamIds` / `tiedTeamIds` / `reviewNote` / `overrideReason`。
- 定榜写入定榜时的完整性名单与复核说明；并列必须填复核说明才能定榜。
- 人工定榜在不完整时把来源说明同时记为**豁免原因**，观众端持续显示。
- 正式榜也标注「并列」「仅一轮」（不再因为定了榜就消失），并列标记覆盖并列的双方。

### 阶段三：准确性与文档

- 修正过期注释与文案：`score` 注释（积分**参与**排名）、“待确认”提示（待确认成绩不参与名次、配对与晋级）。
- `scripts/robustness-check.ts`：把“前 16 名长度正确”改为**先断言前提**（成绩完整、正式名次成立），再用前 16 名作参赛名单——避免检查脚本自己把部分数据固化成晋级结论。
- 文档：[OPERATOR_GUIDE](../OPERATOR_GUIDE.md) 排位赛与排名步骤、[RULES.md 排位赛定榜门禁](../RULES.md#排位赛定榜门禁)、[IMPLEMENTATION_PLAN](../IMPLEMENTATION_PLAN.md) 口径更新注记。

## 两处设计细化（与初版计划的差异）

1. **R1 门禁判“正式名次是否成立”，而不是“成绩是否完整”。**
   计划初稿要求成绩完整才能生成 R1；实现后发现这会把合法流程一并拦死：裁判组直接核分录入名次（`applyQualificationRanking` + 来源说明）本来就是正式名次。现口径为
   `已确认 且（成绩完整 或 有人为来源）`，与观众端“正式名次”判定完全一致（`src/domain/swiss.ts`）。
2. **豁免信道复用显式人工定榜路径。**
   自动定榜（`confirmQualificationRanking`）**永不**豁免：成绩不完整时直接失败。确需在成绩不全时定榜，只能走人工覆盖并填写来源说明，该说明同时写入 `overrideReason`。
   公开 schema 仍为 1：只新增可选字段，并已加“旧快照可解析”的回归测试。

## 本次验证

| 检查 | 命令 | 实际结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | ✅ 通过（0 错误） |
| Lint | `npm run lint` | ✅ 通过 |
| 单元测试 | `npm test` | ✅ **297 项通过**（新增 16 项定榜门禁/复核记录用例） |
| 观众端 e2e | `npx playwright test` | ✅ **332 项通过**（Chromium 桌面/手机/平板 + WebKit 手机；含新增 3 项） |
| 本地工作台 e2e | `npx playwright test --config playwright.operator.config.ts` | ✅ **16 项通过**（Chromium + WebKit，0 重试） |
| 数据校验 | `npm run validate:data` | ✅ 0 错误 0 提示 |
| 集成检查 | `npm run check:integration` | ✅ 全链路通过（种子 → 排位排名 → R1…决赛 → 冠军） |
| 健壮性检查 | `npm run check:robustness` | ✅ **132 项通过**（含新增“成绩不完整时不得定榜”“定榜前提”两项） |

新增用例直接针对报告的现象：

- 领域：确认单条成绩后 `ranking.status` 仍为 `none`、`orderedTeamIds` 为空；
  经工作台“保存并确认结果”录入后同样不定榜，且提示写明“尚未定榜”；
  缺一支队伍即拒绝定榜并指出缺谁；只录到一轮不阻断但会列出；并列写入并列出；
  成绩不完整时 R1 被阻断；人工登记（有来源说明）可以推进；无来源说明时发布校验报错。
- 观众 e2e（`tests/e2e/qualification-partial.spec.ts`）：部分成绩快照下，`/progress` 只显示「当前排行」且含“实时 · 成绩不完整”“不作为晋级依据”，逐行出现「无成绩」「仅一轮」「并列」，页面不出现「晋级十六强／优秀奖／晋级状态／正式名次」；`/teams` 与队伍详情只说“当前第 N 位（未确认）”；定榜后的快照仍回到「正式排名 + 晋级状态」。
- 工作台 e2e：确认一条排位赛成绩后生成观众预览，预览里的晋级页只出现「当前排行」，不出现任何晋级徽章（这是用户报告的操作路径本身）。

## 数据影响

- 正式源 `data/event.json` 与公开快照 `public/data/event.json` 当前均为赛前状态
  （44 条跑图全部 `none`、`ranking.status = "none"`、`orderedTeamIds` 为空），
  **本次未向正式数据写入任何合成赛果**，也没有需要迁移的脏数据。
- 公开快照中的排位赛名次结构不变；新增字段为可选，发布时由 `npm run data:build` 自动带上。

## 未验证项与未做事项

- 未在真实赛事现场数据上验证（当前无现场成绩）；「当前排行」在 22 队成绩只录了一部分、只录一轮、存在并列这几种形态下的观众端表现由合成快照覆盖。
- `confirmQualificationRuns`（批量确认）目前**没有工作台入口**，只有测试与脚本使用；本次只加了“不会定榜”的说明与测试，未接回 UI。若将来接回，定榜仍必须走 `confirmQualificationRanking`。
- 未为并列/缺成绩场景补充截图（旧验收截图不代表新口径），证据以自动化用例为准。

## 相关文档

- [排查与修复计划](../qualification-ranking-gate-plan.md)（完整问题清单与逐条证据）
- [规则说明 · 排位赛定榜门禁](../RULES.md#排位赛定榜门禁)
- [维护操作手册](../OPERATOR_GUIDE.md)
