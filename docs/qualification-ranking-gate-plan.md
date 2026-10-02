# 排位赛「自动断言名次」缺陷 · 排查与修复计划

> 状态：**排查完成，三阶段均已于 2026-10-03 实施并验收**（提交 `ac2fbd8`、`3212f78` 及文档提交）。
> 本页保留当时的排查证据与设计口径；**实际验收结果与两处设计细化见
> [验收记录](acceptance/2026-10-03-qualification-ranking-gate.md)**。
> 排查方式：静态阅读 + 逐条核对 `src/domain`、`src/operator`、`src/pages`、`src/data`、`scripts`、`docs` 与 `data/event.json`。
> 结论可信度：所有条目均给出 `文件:行号`；无法确证的标注「未验证」。

### 决策记录

| 议题 | 结论 |
| --- | --- |
| ③ **成绩不完整时观众端如何展示** | **已定（用户确认）**：允许显示**实时排行榜**，但必须明确标注这是「当前排行」，并且**不得据此断言谁会晋级**。已实现。 |
| ① 只录到一轮是否算有效参与排名 | **已按建议执行**：算（规则允许一轮为最优），但会被列出并要求复核；并列必须填写复核说明。 |
| ② 是否保留「成绩不完整也能定榜」的豁免信道 | **已按建议执行并收紧**：只保留显式人工定榜一条豁免路径（必须填来源说明），自动定榜永不豁免。 |
| ④ 是否接受给公开 schema 增加可选字段 | **已按建议执行**：仅新增 `.nullable().default(null)` 字段，不升 `schemaVersion`，并加了“旧快照仍可解析”的回归测试。 |

决策 ③ 带来一个必须写进设计的约束：**实时排行只能是"派生结果"，不允许落库、不允许被业务逻辑消费**；被持久化、被 `qualifiedTeamIds` / 八强种子 / R1 配对消费的，只能是经过显式确认的**正式名次**。详见 §6.4。

### 实施结果（2026-10-03）

三阶段全部落地：`ac2fbd8`（阶段一：止血 + 门禁 + 当前排行）、`3212f78`（阶段二：复核记录与 schema 字段）、随后一次文档提交（阶段三：注释/脚本/文档/验收）。

实施中做了**两处必要的细化**，与本文初稿不同，以验收记录为准：

1. **R1 门禁判「正式名次是否成立」，而不是「成绩是否完整」。**
   初稿要求成绩完整才能生成 R1；实测会把合法流程一并拦死——裁判组直接核分录入名次
   （`applyQualificationRanking` + 来源说明）本来就是正式名次。最终口径
   `已确认 且（成绩完整 或 有人为来源）`，与观众端「正式名次」判定同源
   （`src/domain/swiss.ts` 的 `qualificationOfficial`）。
2. **豁免信道复用显式人工定榜路径。**
   自动定榜 `confirmQualificationRanking` 永不豁免；成绩不完整时它直接失败并列出缺谁。
   确需在成绩不全时定榜，只能走人工覆盖并填写来源说明，该说明同时写入 `overrideReason`。

---

## 1. 一句话结论

`applyQualificationAutoRanking` **无条件**把排位赛名次写成「已确认 + 已公布」，而它在**每确认一条跑图成绩**后都会被自动调用；`computeQualificationRanking` 又会为全部 22 支竞技组队伍都产出条目。于是**只确认 1 条成绩**，系统就会输出一份看起来完整的 1–22 名，并据此对观众断言「第 1–16 名晋级十六强、第 17–22 名优秀奖」——而且这 22 个名次里，除第 1 名外全部是按 `teamId`（恰好等于三审排名顺序）稳定排序的结果，**看起来毫无破绽**。

这不是单点展示问题：同一份假名次还会**反向决定瑞士轮 16 强名单**，并让「生成第一轮对阵」的门禁**自我通过**。

---

## 2. 事实基线

### 2.1 数据现状（好消息：尚未造成线上事故）

| 位置 | 事实 |
| --- | --- |
| `data/event.json:2499-2502` | `ranking.orderedTeamIds = []`、`bestResultLabels = null`、`status = "none"`、`publicationStatus = "draft"` |
| `data/event.json`（44 条 `qualification.runs`） | 全部 `resultStatus: "none"`、`score: null` |
| `public/data/event.json:2504-2506` | 公开快照同样是空名次 |
| `finals.seeding` | `null`；瑞士轮 33 槽全部 `slots[].kind = "pending"` |

即：**当前正式数据与公开快照都处于赛前状态，缺陷尚未触发**。风险集中在比赛当天。

### 2.2 文档已经写明的口径（实现与文档不一致）

- `docs/RULES.md:387-391`：维护草稿只在本机；正式站数据只能来自通过校验并发布的快照；观众可见「待确认成绩」，但**它不能参与正式配对或晋级**；计划时间已过**不得自动**改状态。
- `docs/RULES.md:400-406`：流程为「录入成绩 → 单场确认 → 全轮校验与确认 → 生成下一轮候选 → 检查 → 公布并冻结」，并明确「可以自动算出候选，但**不能因为一次输入保存就自动对外宣布**」。
- `docs/OPERATOR_GUIDE.md:120`：排位赛的**规定动作**是「核对自动排名，点『采用这个名次并写入草稿』」。

**结论**：隐式定榜既违反 `RULES.md` 的「不得因一次输入对外宣布」，也把 `OPERATOR_GUIDE` 里那一步变成了无意义的空操作——那一步其实已经不需要点了，因为早就自动写入了。

---

## 3. P0 根因链（触发 → 扩散 → 断言）

```
确认 1 条跑图成绩
  └─ src/operator/result-edit.ts:121-127   confirm 时调用 applyQualificationRun，随后调用 applyQualificationAutoRanking
       └─ src/operator/draft.ts:541-591
            ├─ :568  orderedTeamIds = 全部 22 队（缺成绩者沉底）
            ├─ :545-565  incomplete / partial / tied 只写进 messages（不阻断、不降级）
            └─ :581-584  status = 'confirmed' + publicationStatus = 'published'  ← 无条件
                 │
                 ├─【通道 A】观众「正式排名」表
                 │    src/pages/ProgressPage.tsx:158 → :175-179（非 confirmed 才显示"尚未公布"）
                 │    → :203  const advanced = index < 16 → :213-214  「晋级十六强」/「优秀奖」
                 │
                 ├─【通道 B】队伍状态徽章
                 │    src/data/view-model.ts:725-731（只看 status）→ 第 N 名·晋级十六强 / 优秀奖
                 │    src/data/view-model.ts:714-715（awards.topSixteen / honorableMention）
                 │    src/data/view-model.ts:737  honorableMention = orderedTeamIds.slice(16)  ← 无任何校验
                 │    → src/pages/TeamsPage.tsx:39、src/pages/TeamDetailPage.tsx:248/253
                 │
                 ├─【通道 C】瑞士轮 16 强名单被替换
                 │    src/data/view-model.ts:487-502  qualifiedTeamIds：status==='confirmed' && length>=16 即返回前 16
                 │    → :507-511 calculateSwissStandings / deriveExtras
                 │    → src/domain/swiss.ts:124-128  R1 配对直接用 orderedTeamIds.slice(0,16)
                 │
                 └─【通道 D】门禁自我通过
                      src/domain/swiss.ts:52-73  R1 门禁只要求 status==='confirmed'，
                      且"前 16 名与参赛队一致"的校验两边同源，必然自洽 → 可生成并公布 R1 对阵
```

关键放大器（第 5 条问题）：`src/domain/qualification-ranking.ts:203-218` 的排序在只有 1 条可比成绩时，比较函数几乎全部返回 `0`，JS 稳定排序**保留输入顺序**，而输入顺序就是 `event.teams` 的顺序——`scripts/seed-data.ts:48-69/97` 显示该顺序等于 `thirdReviewRank` 顺序。**假名次与三审排名完全一致，人工肉眼无法察觉。**

---

## 4. 问题清单

严重度：P0 = 会对外输出错误结论；P1 = 诚实信号丢失或状态不一致；P2 = 文案/注释/脚本准确性。

### P0-1 一条成绩即输出完整 1–22 名 + 晋级结论
- 证据：`src/operator/draft.ts:568`、`:581`、`:583`；`src/domain/qualification-ranking.ts:189-195`、`:220`；`src/pages/ProgressPage.tsx:158`、`:175-179`、`:199-219`、`:203`、`:213-214`、`:206`
- 校验层不设防：`src/domain/validation.ts:182-195` 只校验「条数 = 22」，`:210-218` 只校验标签数量。
- 影响：观众看到 22 行完整名次表、每行带「晋级十六强/优秀奖」徽章，表头正上方还有 `src/pages/ProgressPage.tsx:183`「第 1–16 名晋级十六强，第 17–22 名结算优秀奖」的确定性文案。
- 触发：任意一次单条跑图确认（`ResultWorkbench`「保存并确认结果」）。

### P0-2 `orderedTeamIds` 被当作"正式名次"消费，观众端零门禁
- 证据：`src/data/view-model.ts:737`（`slice(16)` → 优秀奖）、`:725-731`、`:714-715`；`src/domain/finals.ts:730-739`（`deriveExtras` **完全不看 `ranking.status`**）；`src/pages/TeamDetailPage.tsx:227`、`:248`、`:253`（只判 `indexOf >= 0` 就显示「**正式**名次第 N 名」）
- 影响：双通道扩散（名次表 + 队伍徽章），且队伍页出现「排位赛正式名次 第 7 名」这类确定表述。
- 备注：`deriveExtras` 无 status 门禁这一点，会让**任何**「保留计算结果但降级 status」的修法被绕过——修 UI 不够，必须修这里。

### P0-3 用数组下标 / 三审顺序"补齐"成看似完整的数据
- 证据：`src/data/view-model.ts:493-501`（未确认时回退到**全部 22 支竞技组队伍按 `event.teams` 原序**）；`scripts/seed-data.ts:93-108` 与 `:97` 显示该顺序 = `COMPETITIVE_ROSTER` = `thirdReviewRank` 顺序；`src/pages/ProgressPage.tsx:531`（`rankWithinGroup || i + 1`）；`src/data/view-model.ts:272`
- 影响：消费者侧没有真正的 `rank` 字段（schema 只存数组，`src/domain/schema.ts:212`），所有名次都是 `index+1` 推出来的；而回退顺序恰好等于三审顺序，**补齐结果与"真实名次"在视觉上不可区分**。

### P0-4 假名次反向决定瑞士轮 16 强与决赛输入
- 证据：`src/data/view-model.ts:487-502`、`:507-511`、`:779`；`src/domain/swiss.ts:124-128`；`src/domain/corrections.ts:55-62`（同样的 `status + length>=16` 判定，注释自称"仅用于预览"）
- 影响：确认 1 条成绩后，另有 6 支竞技组队伍会**从瑞士轮战绩表中消失**（`teamIds` 由 22 变 16），且这 16 支是"1 支真成绩 + 15 支按队号排序"。
- 架构层面的根因：`src/operator/draft.ts:17` 让**领域/维护层直接 import 展示层**的 `qualifiedTeamIds`（`src/data/view-model.ts:487`），而该函数的兜底分支是"返回全部 22 支竞技组队伍"（`src/data/view-model.ts:501`）。一个纯展示用的兜底因此变成了 R1 配对、种子计算（`src/operator/draft.ts:656`、`:694`、`:808`）的规则输入。这是"展示约定泄漏成规则约定"的典型例子，修复时应当把这条依赖方向倒过来（规则函数放 `src/domain`，展示层调用它）。

### P0-5 仅有 1 条成绩时名次退化为按 `teamId` 排序，仍标注"正式"
- 证据：`src/domain/qualification-ranking.ts:203-218`（比较函数分支全部返回 0）、`:220-241`（`rank: index + 1`）
- 影响：这是最隐蔽的一处——退化结果与三审排名一致，`docs` 里也没有任何交叉校验能发现它。

### P0-6 门禁自我通过，可据此公布第一轮对阵
- 证据：`src/domain/swiss.ts:52-73`（R1 只要求 `qualification.status === 'confirmed'`，随后校验「前 16 名」与 `ctx.teamIds` 一致，而 `ctx.teamIds` 正是由同一个 `qualifiedTeamIds` 推出的同一个前 16）
- 影响：单条成绩确认 → `generateNextRound(1)` 通过 → 维护者可「公布这 8 场对阵并冻结」，把假排名固化成正式赛程（`src/operator/draft.ts:678-766`）。

### P1-1 完整性/并列信号只有维护端可见
- 证据：计算层产出 `tiedWithPrevious`/`tiedTeamIds`/`partialTeamIds`/`incompleteTeamIds`（`src/domain/qualification-ranking.ts:222-247`），维护端消费（`src/operator/PlanningPanels.tsx:52-69`、`:89`；`src/operator/draft.ts:545-565`），**观众端全文无消费点**（`src/pages`、`src/data` 检索为空）。
- 影响：并列被静默显示成第 1 名、第 2 名；缺成绩队伍与有名次队伍视觉上完全等价。

### P1-2 复核状态不持久化、不可审计
- 证据：`src/domain/schema.ts:209-222` 的 `qualificationRankingSchema` 只有 `orderedTeamIds / bestResultLabels / status / confirmedAt / sourceNote / publicationStatus / publishedAt`，**没有完整性或复核字段**；因此 `draft.ts:545-565` 的警告只是瞬时 toast，随页面消失，也不进入公开快照。
- 影响：事后无法回答"定榜时是否已知成绩不全、谁批准的"。

### P1-3 两条确认路径行为不一致
- 证据：`src/operator/draft.ts:473-506` `confirmQualificationRuns`（批量确认）**不重算名次**；而单条确认走 `result-edit.ts:121-127` 会重算。`confirmQualificationRuns` 与 `qualificationProgress`（`:509-522`）在 `src/**/*.tsx` 中**无任何调用点**（仅测试引用），但 `docs/acceptance/ACCEPTANCE.md:44` 声称存在「全部确认」入口。
- 影响：一旦接回 UI，会产出"成绩已确认、名次还是旧的"这一更危险的状态。

### P1-4 更正影响面基于存储的假名次计算
- 证据：`src/operator/result-edit.ts:60-70`（`impact.rankingChanges` 比较更正前后的 `ranking.orderedTeamIds`）；`src/domain/corrections.ts:55-62`
- 影响：修好 P0 后若仍从"存储的名次"取前后值，更正预览会得出"排名无变化"之类的错误结论（当前 `tests/support/operator-edits.test.ts:107-117` 恰好依赖这条路径）。

### P2-1 检查脚本把 `slice(0,16)` 固化成"晋级名单"
- 证据：`scripts/robustness-check.ts:343`（只断言长度 16）、`:351`（`top16` 直接作为后续输入）、`:374`

### P2-2 注释与文案不准确
- `src/domain/schema.ts:198`：`score` 注释写「不参与自动确定排位名次」，与实际排序规则相反。
- `src/operator/draft.ts:465`：待确认提示「确认后才会出现在跑图记录中」，但观众端跑图表实际会显示 `待确认` 行（`src/pages/ProgressPage.tsx:320-328`）。
- `src/operator/draft.ts:538-539`：注释自述「绝不假装名次已经确定」，与 `:581-584` 行为矛盾。

### P2-3 测试没有守住这个缺陷
- `tests/fixtures/audience-scenarios.ts:23-29` 只构造「44 条全部录入后再 `applyQualificationAutoRanking`」的场景。
- `tests/operator-e2e/workbench.spec.ts:58-76` 确认 1 条跑图后只断言预览横幅与变更条数，**不检查预览里是否已经出现晋级结论**。
- `tests/domain/qualification-runs.test.ts`、`tests/support/operator-edits.test.ts:99-105` 只断言 `resultStatus`，未断言 `ranking.status` 应保持 `none`。

---

## 5. 已核对且判定无问题的部分（避免重复排查）

| 位置 | 结论 |
| --- | --- |
| `src/domain/qualification-ranking.ts:102-105` | `isUsable` 只认 `resultStatus === 'confirmed'`，草稿成绩不参与排名 ✔ |
| `src/domain/scores.ts:122-142` | 瑞士轮统计只取 `effectiveAttemptId` 且 `confirmed` 的那一次，重赛旧记录不重复计入 ✔ |
| `src/operator/draft.ts:57-60`、`:203-206`、`:299-305` | 胜者必须显式传入并必须是参赛双方之一，**不会从积分推断胜者** ✔ |
| `src/operator/draft.ts:367-379` | `seriesWins` 只累计已确认小局 ✔ |
| `src/operator/draft.ts:655-671` | `generateNextRound` 只产出候选，不写 `publicationStatus` ✔ |
| `src/operator/draft.ts:678-766` | `publishRound` 是唯一改变对外对阵的操作，且拒绝覆盖已开赛轮次 ✔ |
| `executionStatus` 的全部写入点（`src/operator/draft.ts:115/238/337/497/730/760`、`src/operator/result-edit.ts:149/194/197`） | 全部由维护者动作（录入、公布、更正、重赛）触发，**没有任何基于时间或计分的自动推进**，符合 `docs/RULES.md:391` ✔ |
| `src/operator/draft.ts:768-801` | `confirmRound` 要求该轮每场都已确认 ✔ |
| `src/operator/draft.ts:807-828` | `publishFinalsSeeding` 要求 R5 已 `closedAt`，且战绩组数量不足即失败 ✔ |
| `src/domain/finals.ts:592-594`、`:467-470`、`:616-619`、`:625-653` | 依赖未决出显示 pending、快照优先、不为并列编造精确名次、冠军只在 `decided` 时产生 ✔ |
| `src/data/view-model.ts:70-91`、`:774-806` | 阶段判定与 `settledUpToRound` 只认已确认结果；`complete` 未被用于对外断言 ✔ |
| `src/domain/standings.ts:209-218` | 缺名次排在有名次者之后，不当 0、不当最后一名 ✔ |
| `src/pages/ProgressPage.tsx:175-179`、`:278-279`、`:685-704` | 未确认时显示「正式排名尚未公布…确认前不推测名次」、空状态、种子待公布 ✔（这是本仓库正确做法的范例） |
| `scripts/build-public-data.ts:46-68` | 公开快照必须依次通过 schema、`validateEvent`、`canExportOfficial` ✔（缺点：这三道门禁都不检查排位赛完成度，见 P0-1） |
| `src/domain/corrections.ts:262-273` | 未处置更正会阻断导出 ✔ |
| `src/pages/SchedulePage.tsx`、`src/components/BracketChart.tsx`、`src/data/bracket-model.ts` | 仅时间/场地与布局绘制；未公布时返回 `pending`，不伪造依赖 ✔ |

---

## 6. 修复计划

### 6.1 设计原则（先立规矩，再改代码）

1. **计算与确认分离**：派生（derive）可以随时算、随时展示给维护者；断言（assert）必须由显式动作产生、并写入数据。参照现有正确范例——`QualificationEntry` 已经用纯函数 `computeQualificationRanking(draft)` 实时预览（`src/operator/PlanningPanels.tsx:25`），它**不需要**先把名次写进 event。
2. **无完整性证明不得对外断言**：任何「晋级/淘汰/优秀奖/正式名次」的输出，都必须同时满足「已确认」+「完整性成立」+「复核已记录」。
3. **豁免必须显式且可审计**：组委会确实要在成绩不全时定榜（例如某队无法产生成绩）时，走一条带原因、带时间戳、且**观众端持续可见**的豁免信道，而不是静默降级。
4. **门禁下沉**：门禁放在 `src/domain`，让工作台、发布校验、公开快照构建、观众端共用同一条判定，避免再出现"只在某个 UI 拦住"。

### 6.2 阶段一（P0，止血；不改数据结构）

| # | 改动 | 位置 |
| --- | --- | --- |
| 1.1 | 删除「确认单条成绩 → 自动写名次」的隐式调用；改为只返回排行预览 | `src/operator/result-edit.ts:121-127` |
| 1.2 | 把 `applyQualificationAutoRanking` 改造为显式动作 `confirmQualificationRanking(event, options)`：**先判定、后写入**，不满足即返回可解释失败 | `src/operator/draft.ts:541-591` |
| 1.3 | 新增纯函数 `assessQualificationCompleteness(event)`（见 §6.4 接口草案） | 新文件 `src/domain/qualification-completeness.ts` |
| 1.4 | 新增统一判定 `officialQualificationRanking(event)`（唯一被业务与"正式名次"展示消费的入口） | `src/data/view-model.ts` 或 `src/domain/qualification-ranking.ts` |
| 1.5 | 观众端名次表改为**三态展示**（详见 §6.4）：① 已确认且完整 → 现有「正式排名」+ 晋级状态列；② 未确认但有已确认成绩 → **「当前排行」实时榜**，标注未确认、**不渲染晋级状态列**；③ 完全没有已确认成绩 → 沿用现有「正式排名尚未公布」空状态 | `src/pages/ProgressPage.tsx:175-179`、`:183`、`:199-219` |
| 1.6 | 队伍状态：未确认时**不得**返回「晋级十六强 / 优秀奖」，只能给「排位赛阶段」或带"当前"字样的实时位次，且必须同时显示未确认标注 | `src/data/view-model.ts:725-731` |
| 1.7 | `deriveExtras` 增加 `ranking` 门禁：`honorableMention` **只能**来自正式名次，未确认/不完整时恒为 `[]`（实时榜绝不产生奖项） | `src/domain/finals.ts:730-739` + 调用点 `src/data/view-model.ts:511` |
| 1.8 | `qualifiedTeamIds` 拆分语义：**业务判定版**只在「已确认 + 完整」时返回前 16，否则返回 `[]`；实时榜另有独立派生函数，**绝不**作为 `qualifiedTeamIds` 的输入 | `src/data/view-model.ts:487-502`、`:507-511`、`:779`；`src/domain/corrections.ts:55-62` |
| 1.9 | 队伍详情页只在正式判定成立时显示「正式名次」；实时状态下显示「当前第 N 位（未确认）」 | `src/pages/TeamDetailPage.tsx:227`、`:248`、`:253` |
| 1.10 | R1 门禁升级为「正式排名成立」（confirmed + complete），并把"自证式"一致性校验改为直接校验排名前 16 与 16 支参赛队 | `src/domain/swiss.ts:52-73` |
| 1.11 | 校验层新增 error：`ranking.status === 'confirmed'` 但完整性不成立且无豁免原因 → 阻断发布（自动同时作用于工作台预检与公开快照构建） | `src/domain/validation.ts:182-221` |
| 1.12 | 新增**实时排行**派生函数（不落库、不被业务消费），承载决策 ③ 的展示需求 | `src/domain/qualification-ranking.ts`（`computeQualificationRanking` 之上薄封装） |

### 6.3 阶段二（P1，诚实信号与一致性）

| # | 改动 | 位置 |
| --- | --- | --- |
| 2.1 | schema 增加可选复核字段（全部 `.nullable().default(null)`，向后兼容）：`missingTeamIds` / `partialTeamIds` / `tiedTeamIds` / `reviewNote` / `overrideReason` | `src/domain/schema.ts:209-222` |
| 2.2 | 定榜时把复核结论写入上述字段；并列时要求人工复核说明 | `src/operator/draft.ts`（新 `confirmQualificationRanking`）、`src/operator/PlanningPanels.tsx:101-108` |
| 2.3 | 实时榜名次列消费 `tiedWithPrevious` / `incomplete` / `partial`，显示「并列」「无成绩」「仅一轮」，而不是把它们静默排成确定位次 | `src/pages/ProgressPage.tsx:203-214` |
| 2.4 | 实时榜的标注文案与规模统计（已确认 N / 44、M 支尚无成绩）落到组件；`bestResultLabels` 不用 `—` 静默兜底 | `src/pages/ProgressPage.tsx:202`、`:182-185` |
| 2.5 | 统一两条确认路径：`confirmQualificationRuns` 接回 UI 时走同一判定，或直接删除该导出与相关文档描述 | `src/operator/draft.ts:473-522`、`docs/acceptance/ACCEPTANCE.md:44` |
| 2.6 | 更正影响面改为比较"计算出的名次"而非"存储的名次" | `src/operator/result-edit.ts:60-70` |

### 6.4 实时排行（「当前排行」）的展示规则 —— 决策 ③ 的落地细则

**核心区分：两份东西、两套规则**

| | 实时排行（当前排行） | 正式名次 |
| --- | --- | --- |
| 来源 | 每次渲染由 `computeQualificationRanking(event)` **现场派生**（本就是纯函数，`src/domain/qualification-ranking.ts:186`） | 显式确认后写入 `qualification.ranking` |
| 是否落库 | **否**——不进 `data/event.json`、不进公开快照、不进本地草稿 | 是 |
| 是否被业务消费 | **绝不**——不参与 `qualifiedTeamIds`、八强种子、R1 配对、奖项结算 | 是 |
| 观众端标题 | 「当前排行」+ 徽章「实时 · 成绩不完整，未确认」 | 「正式排名」+「已确认」 |
| 晋级/淘汰/优秀奖 | **一律不显示** | 正常显示 |
| 进入条件 | 至少一条已确认且可比较的成绩 | `status === 'confirmed'` 且完整性成立（或存在豁免原因） |

**实时榜必须同时满足的标注（缺一不可）**

1. 标题为「当前排行」，全页不得出现「正式」「最终」「已确认」等确定性字样；
2. 紧跟一行说明：「实时 · 成绩不完整，未确认，**不作为晋级依据**」；
3. 给出已录入规模，例如「已确认 12 / 44 次跑图；22 支队伍中 10 支尚无成绩」；
4. **逐行**标注数据状态：`无成绩`、`仅一轮`、`并列`（计算层已有 `incomplete` / `partial` / `tiedWithPrevious` 字段，现成可用）；
5. 「晋级状态」列**整列不渲染**（不是渲染成空值），表头也不出现「晋级状态」四个字。

**位次措辞（避免读者误读为官方名次）**

- 表格首列用「当前第 1 位」，**不用**「第 1 名」；
- 队伍卡片与详情页用「当前第 7 位（未确认）」；**不得**写成「排位赛正式名次 第 7 名」——这正是现在 [`TeamDetailPage.tsx:248`](src/pages/TeamDetailPage.tsx:248) 的写法；
- 尚无成绩的队伍仍按现有口径沉底（`src/domain/qualification-ranking.ts:197-198`、`:220`），但必须带「无成绩」标记，**不能给它一个看起来正常的位次**；
- `src/pages/ProgressPage.tsx:183` 那句「第 1–16 名晋级十六强，第 17–22 名结算优秀奖」在实时榜状态下**必须不出现**（它是规则陈述，但紧贴实时数据会被读成既成事实）。

**边界情况**

- 一条已确认成绩都没有 → 不显示实时榜，沿用现有空状态与「确认前不推测名次」文案（`src/pages/ProgressPage.tsx:175-179`）；
- 已确认且完整 → 切回现有「正式排名」渲染，行为与修复前一致；
- 已确认但不完整、且组委会走了豁免信道定榜（`overrideReason` 非空）→ 按「正式排名」渲染，但标题旁**持续显示豁免原因**，不能静默。

**为什么实时榜必须是派生、不能落库**：本次缺陷的本质，就是"部分数据算出来的顺序"被写进了官方字段，随后被下游当成既成事实。实时榜一旦落库，等于把同一个坑换个名字重挖一遍。因此 §6.4 的接口草案里，实时榜函数明确标注「不落库、不参与业务判定」。

### 6.5 接口草案（供评审，尚未实现）

```ts
// src/domain/qualification-completeness.ts
export interface QualificationCompleteness {
  /** L1 硬门禁：每支竞技组队伍至少有一条已确认且积分可比较的成绩。 */
  ok: boolean;
  teamCount: number;
  /** 至少有一条已确认且积分可解析的队伍。 */
  scoredTeamIds: string[];
  /** 无任何可比成绩（含只有成绩文字、没有积分）。 */
  missingTeamIds: string[];
  /** 只录到一轮可比成绩。 */
  partialTeamIds: string[];
  /** 积分与用时完全相同、需人工区分。 */
  tiedTeamIds: string[];
  /** 面向维护者的可读原因；ok 为 true 时为 null。 */
  reason: string | null;
}
export function assessQualificationCompleteness(event: EventFile): QualificationCompleteness;
```

```ts
// src/domain/qualification-ranking.ts
/**
 * 实时排行：现场派生，**绝不落库、绝不参与业务判定**
 * （不参与 qualifiedTeamIds / 八强种子 / R1 配对 / 奖项结算）。
 * 观众端只能以「当前排行」名义展示，并必须同时标注未确认与不完整。
 */
export interface LiveQualificationRanking {
  entries: {
    teamId: string;
    /** 1 起的"当前位次"，措辞为「当前第 N 位」，不是「第 N 名」。 */
    position: number;
    label: string;
    score: number | null;
    elapsedSeconds: number | null;
    /** 该队没有任何已确认且可比较的成绩。 */
    incomplete: boolean;
    /** 只录到一轮。 */
    partial: boolean;
    /** 与上一位完全相同，无法由数据区分。 */
    tiedWithPrevious: boolean;
    round: 1 | 2 | null;
  }[];
  /** 用于"已确认 N / 44 次跑图"的规模标注。 */
  confirmedRunCount: number;
  totalRunCount: number;
  teamCount: number;
  incompleteTeamIds: string[];
  partialTeamIds: string[];
  tiedTeamIds: string[];
}
export function liveQualificationRanking(event: EventFile): LiveQualificationRanking;
```

门禁分级（建议）：

- **L1 硬门禁**：`missingTeamIds.length === 0`。不满足 → 拒绝写入 `status: 'confirmed'`，失败信息列出缺失队伍名。
- **L2 复核门禁**：`partialTeamIds` 或 `tiedTeamIds` 非空 → 仍可定榜，但必须填写复核说明（谁在何时核对了这些队伍），并持久化。
- **豁免信道**：`allowIncomplete: true` 且 `overrideReason` 非空 → 允许定榜，`overrideReason` 写入数据并在观众端**持续显示**。

### 6.6 阶段三（P2，准确性与回归网）

| # | 改动 | 位置 |
| --- | --- | --- |
| 3.1 | 修正过期/不实注释与文案（`score` 参与排名、待确认提示、`applyQualificationAutoRanking` 自述） | `src/domain/schema.ts:198`、`src/operator/draft.ts:465`、`:538-539` |
| 3.2 | 检查脚本改为"完整性成立才允许断言晋级名单"，不完整时断言"系统必须报告不完整" | `scripts/robustness-check.ts:343`、`:351`、`:374` |
| 3.3 | 文档更新：`OPERATOR_GUIDE` 增加"确认排名"步骤的硬性前置条件；`RULES.md` 补「排位赛定榜门禁」小节 | `docs/OPERATOR_GUIDE.md:87`、`:120`；`docs/RULES.md:387-406` |
| 3.4 | 追加验收记录（按仓库惯例放 `docs/acceptance/`） | 新增 |

**必加测试（每条都要能在"移除修复后失败"）：**

1. 领域单测：确认 1 条跑图 → `ranking.status` 仍为 `none`（或 `provisional`），且 `orderedTeamIds` 不被写入。
2. 领域单测：22 队缺 1 队成绩 → `confirmQualificationRanking` 失败且信息含该队名。
3. 领域单测：44 条全部确认 → 定榜成功，`missingTeamIds = []`；并列时 `tiedTeamIds` 非空且需复核说明。
4. 领域单测：排名不完整时 `generateNextRound(1)` 返回阻断（信息含"成绩不完整"）。
5. 领域单测：构造 `confirmed` 但不完整的数据 → `validateEvent` 产出 `ranking-confirmed-incomplete` error。
6. 观众 e2e（**实时榜**，决策 ③）：加载"部分录入"快照，断言 `/progress` 出现「当前排行」与未确认标注、不出现「晋级状态」列；`/`、`/progress`、`/teams`、`/teams/:id` 的 `main` 文本**不含** `晋级十六强`、`优秀奖`、`正式排名`、`正式名次`；无成绩队伍带「无成绩」标记。
7. 观众 e2e（**正式榜不得被实时榜污染**）：同一快照下，`qualification.ranking.status` 保持 `none`、`orderedTeamIds` 为空、八强种子区仍为「尚未公布」。
8. 观众 e2e（**回归**）：44 条全部确认并显式定榜的快照，渲染结果与修复前一致（「正式排名」+ 晋级状态列）。
9. 操作端 e2e：确认 1 条跑图 → 「生成观众预览」→ 预览 iframe 内出现的是「当前排行」且不含任何晋级徽章；点「采用这个名次并写入草稿」被拒并提示缺失队伍；补齐后成功。

### 6.7 验收标准

- 现有 22 队 × 2 轮（44 条）全部确认后，一次性定榜，输出与修复前**完全一致**（对完整数据无行为回归）。
- 任意"部分录入"状态：观众端**可以**看到实时排行，但必须同时满足 §6.4 的 5 项标注；且四个页面均**不出现**任何晋级/淘汰/优秀奖断言与「正式名次」措辞。
- 实时排行在任何情况下都**不写入数据**：`ranking.status` 恒为 `none`、`orderedTeamIds` 为空，直到显式定榜动作发生。
- 无法通过任何单次成绩录入动作改变 `ranking.status`。
- 公开快照构建在"confirmed 但不完整"的数据上**失败**并给出可读原因。
- 全部既有单测/e2e 通过（允许按 §7 改写白名单内的用例）。

---

## 7. 影响面、风险与回滚

### 7.1 需要同步改写的既有测试（唯一的"破坏性"部分）

| 用例 | 原因 |
| --- | --- |
| `tests/support/operator-edits.test.ts:107-117` | 断言"两次排位确认后 `impact.rankingChanges` 长度为 2"，依赖隐式定榜；应改为比较**计算出的名次**变化 |
| `tests/support/operator-edits.test.ts:99-105` | 建议追加断言：确认后 `ranking.status` 仍非 `confirmed` |
| `tests/operator-e2e/workbench.spec.ts:58-76` | 需追加"预览中不含晋级结论"的断言 |

不受影响：`tests/fixtures/audience-scenarios.ts:29`、`scripts/make-full-season-snapshot.ts:64`、`scripts/robustness-check.ts:171`、`scripts/integration-check.ts:50-59` 都是**显式**调用定榜/人工排名，语义不变。

### 7.2 数据与 schema

- **无数据迁移**：正式源与公开快照的 `ranking` 当前为空，不存在脏数据。
- 阶段二给 `qualificationRankingSchema` 增加可选带默认值字段属**向后兼容**（旧快照仍可解析）。是否需要同步更新 `docs/RULES.md` 的 schema 说明与 `schemaVersion` 由 `docs/IMPLEMENTATION_PLAN.md` 的兼容约定决定——**建议不升版本，仅补文档**。
- 本地未发布的旧草稿若已含有"单条成绩定出的名次"，需在阶段一上线后**重新核对**（可在发布预检中提示"本草稿的名次缺少完整性记录"）。

### 7.3 风险

| 风险 | 缓解 |
| --- | --- |
| 门禁过严：某队确实无法产生成绩 | 走 `overrideReason` 豁免信道；不做"默认放行" |
| "只录到一轮"是否算有效成绩有争议 | 见 §8 第 1 项；建议"算，但需复核记录" |
| 观众端赛前不再能看到 22 队瑞士轮战绩表 | 战绩表属展示层，与实时榜同理：以「参考战绩（参赛 16 强待确定）」名义展示，**不与 `qualifiedTeamIds` 混用** |
| 改动面较大（约 10 个源文件 + schema + 文档） | 阶段一可独立上线并单独验收；阶段二三可分批 |

### 7.4 回滚

本方案不修改数据，回滚只需还原代码提交；阶段二新增的字段为可选字段，回滚后残留字段不影响旧代码解析（`.strict()` 下需确认字段已声明，因此回滚应同时在 schema 中保留声明）。

---

## 8. 待决策与已定事项

| # | 议题 | 状态 |
| --- | --- | --- |
| ③ | 成绩不完整时观众端的展示 | **已定并实现**：显示实时排行榜，标注为「当前排行」，**不得据此断言谁晋级**。落地细则见 §6.4，对应改动 1.5 / 1.6 / 1.12。 |
| 1 | 「只录到一轮」是否算有效参与排名？ | **已实现**：算（规则允许一轮为最优），但会被列出；并列必须填写复核说明，且复核记录随名次持久化。 |
| 2 | 是否保留「成绩不完整也能定榜」的豁免信道？ | **已实现并收紧**：只保留显式人工定榜一条路径（必须填来源说明），自动定榜永不豁免。 |
| 4 | 是否接受给公开 schema 增加可选字段？ | **已实现**：新增 `.nullable().default(null)` 字段，不升 `schemaVersion`，并加“旧快照可解析”回归测试。 |

---

## 9. 附：问题分布速查

| 严重度 | 条目 | 主要位置 |
| --- | --- | --- |
| P0 | 6 条 | `draft.ts:541-591`、`result-edit.ts:121-127`、`view-model.ts:487-502/725-737`、`finals.ts:730-739`、`ProgressPage.tsx:158-219`、`TeamDetailPage.tsx:227/248/253`、`swiss.ts:52-73`、`validation.ts:182-221` |
| P1 | 4 条 | `schema.ts:209-222`、`draft.ts:465/473-522/538-539`、`result-edit.ts:60-70`、`corrections.ts:55-62` |
| P2 | 3 条 | `schema.ts:198`、`robustness-check.ts:343/351/374`、`tests/**`、`docs/**` |
