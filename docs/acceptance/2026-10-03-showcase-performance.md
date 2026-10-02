# 2026-10-03 展示组「单独演出」误报为自我对阵的修复

## 用户报告

> 6 项待处理问题，处理后才能发布
> series：showcase-final-1 的两个槽位来源完全相同，构成自我对阵
> …（三场各两条：席位来源重复 + 参赛快照自我对阵）

## 根因

展示组是**单独演出**（BO2 表演，单队上台），不是两队对阵。但历史实现里，登记抽签时把同一支队同时写进了两个席位和"参赛双方"快照：

```
showcaseTeamId: teamId,
participantSnapshot: [teamId, teamId],                    // 谎报"双方"
slots: [{kind:'team',teamId}, {kind:'team',teamId}]        // 谎报"两个席位"
```

而校验按竞技比赛规则检查自我对阵（`src/domain/finals.ts` 的图校验与 `src/domain/validation.ts` 的对阵类校验），于是三场演出各报两条，合计 6 条 **error**，把整份草稿的发布一并挡住。

观众端其实从不读这两个字段：演出队伍来自 `showcaseTeamId`，第二个位置固定显示「单队展示」（`src/data/view-model.ts`、`src/pages/MatchDetailPage.tsx`）。因此这两个字段既多余，又是把演出当成比赛的错误编码。

## 修复

1. **数据层（根因）**：`applyShowcaseDraw` 只写 `showcaseTeamId`，并把 `slots` 与 `participantSnapshot` 显式置为 `null`；重新登记一次即可顺手修正历史草稿里的旧值。
2. **校验层（区分演出与对阵）**：
   - `validateFinalsGraph`：跳过展示组的自我对阵检查（第 3、4 条），竞赛场次检查不变；
   - `validateEvent`：展示组不套用对阵类校验（自我对阵、已确认必须有胜者、胜者须为参赛方），但**仍然**校验队伍与日程项引用；新增 `showcase-winner` 错误——演出记胜者等于把演出当成比赛。
3. **文档**：[RULES.md](../RULES.md) 新增「展示组是单独演出，不是对阵」小节；[OPERATOR_GUIDE](../OPERATOR_GUIDE.md) 抽签步骤注明不产生对阵。

## 本次验证

以用户报告的场景做修前/修后对照（临时脚本，跑完即删）：

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 已登记过抽签的旧草稿（同队两席位 + 同队快照） | 6 条 error，发布被挡 | **0 条 error**，可直接发布 |
| 重新登记抽签 | 写入 `slots:[X,X]`、`snapshot:[X,X]` | 写入 `showcaseTeamId`，`slots=null`、`snapshot=null` |

自动化检查：

| 检查 | 实际结果 |
| --- | --- |
| 类型检查 / Lint | ✅ 通过 |
| 单元测试 | ✅ **304 项通过**（新增 `tests/domain/showcase-performance.test.ts` 6 项 + 观众模型 1 项） |
| 展示组观众端 e2e | ✅ 12 项通过（Chromium 桌面/手机/平板 + WebKit） |
| 全部观众端 e2e | ✅ 329–332 项通过（见下方"环境抖动"） |
| 本地工作台 e2e | ✅ 16 项通过（Chromium + WebKit） |
| `validate:data` / `check:integration` / `check:robustness` | ✅ 通过（健壮性 132 项） |

新增用例覆盖：抽签只写演出队伍、抽签后 `validateEvent` 零错误、**旧草稿的遗留值不再报自我对阵**、竞技场次的自我对阵仍被拒绝（豁免不过宽）、演出可确认但无需胜者、演出记胜者被拒绝、抽签后观众端仍是单队演出。

## 环境抖动说明

本地并行跑全部 4 个观众端项目时，`mobile-webkit` 的布局断言（360px 无横向溢出等）偶发超时失败；单独重跑该 spec 3 次全部通过，单独跑整个 `mobile-webkit` 项目 82/83 通过、重跑通过。属于 WebKit 在并行负载下的渲染时序抖动，与本次改动无关（这些用例只渲染竞技组决赛图，不涉及展示组）。CI 配置本身对端到端用例设置了 `retries: 1` 正是为此。

## 数据影响

正式源与公开快照中的展示组本来就是 `slots: null`、`showcaseTeamId: null`（尚未抽签），无需迁移。若草稿中存在旧版本写入的同队两席位/快照，可在下次「登记抽签顺序」时自动清掉；不清也不影响校验与展示。

## 相关文档

- [规则说明 · 展示组是单独演出](../RULES.md)
- [排位赛定榜门禁与「当前排行」](2026-10-03-qualification-ranking-gate.md)（同日另一处"把非结论当成结论"的修复）
