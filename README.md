# RoboGame2026 赛程可视化工具

RoboGame2026 赛事的赛程与结果网站：读取比赛结果，计算瑞士轮评分、排名、
后续对阵与决赛晋级，并清楚区分**待确认**与**正式公布**的信息。

- 中文界面，移动优先，纯静态（React + TypeScript + Vite）
- 托管：GitHub Pages（hash 路由，深链刷新不 404）
- 数据：单一正式输入 `data/event.json`，本地录入 → Git 提交 → Actions 自动发布
- 公开站点**只读**，没有结果写入能力

---

## 快速开始

```bash
npm ci                 # 安装锁定依赖
npm run data:seed      # 生成初始数据（仓库已含 data/event.json 时可跳过）
npm run dev            # 启动观众站（http://127.0.0.1:5173）
```

首次运行前请确认 Node 版本符合 `.nvmrc`（当前为 24）。

---

## 全部命令

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run dev` | 启动观众站开发服务器 |
| `npm run operator` | 启动**本地维护工具**（仅本机，入口 `http://127.0.0.1:5199/operator.html`） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm run test` | 领域单元测试（Vitest） |
| `npm run test:e2e` | 端到端测试（Playwright，跑在生产构建上） |
| `npm run validate:data` | 校验 `data/event.json` |
| `npm run data:seed` | 生成初始数据骨架（默认拒绝覆盖已有赛果） |
| `npm run data:import -- --file <export.json>` | 只导入变更包（不提交） |
| `npm run data:build` | 生成公开快照 `public/data/event.json` |
| **`npm run publish -- --file <export.json> -m "说明"`** | **一条命令完成发布**（导入+校验+构建+提交+推送） |
| `npm run build` | 校验数据 + 生成快照 + 类型检查 + 生产构建 |
| `npm run preview` | 本地预览生产构建 |

> `npm run build` **包含**数据校验与公开快照生成，不会忘记更新 public 数据。

---

## 日常更新流程（3 步）

```bash
git pull                                   # 1. 先同步
npm run operator                           # 2. 打开维护工具录入，导出变更包
npm run publish -- --file <导出文件> -m "说明"   # 3. 发布
```

> `npm run operator` 会自动打开录入页 `http://127.0.0.1:5199/operator.html`。
> **根地址 `http://127.0.0.1:5199/` 是只读的观众站**，上面没有录入表单。

`publish` 会自动完成 **导入 → 校验 → 生成快照 → 提交 → 推送（失败自动重试）**，
任一步失败都会**回滚** `data/event.json`，不会留下半成品。

想先看看效果再加 `--dry-run`（只导入校验，不提交）。

发布后仍需**手动确认观众已看到**：等 Actions 变绿 → 打开站点看「数据更新时间」。
详见 [`docs/OPERATOR_GUIDE.md`](docs/OPERATOR_GUIDE.md) §9。

---

## 项目结构

```text
RG26/
  RoboGame2026赛程安排.docx      # 原始资料（不进入公开产物）
  data/event.json                # 唯一正式输入文件
  public/data/event.json         # 构建生成的公开快照（不手工维护）
  docs/
    IMPLEMENTATION_PLAN.md       # 实施计划（需求与验收依据）
    RULES.md                     # 规则、公式、统计口径、未明确项
    OPERATOR_GUIDE.md            # 维护者操作手册
    DEPLOYMENT.md                # 部署与排错
    acceptance/                  # 验收记录与截图
    reference/                   # 原文提取与名单图片
  src/
    app/                         # 路由、布局、hash 查询参数
    components/                  # 共享展示组件
    pages/                       # 总览、赛程、晋级、队伍、比赛详情、规则
    domain/                      # 领域层（纯逻辑，不依赖 React）
      rational.ts                # BigInt 有理数运算
      schema.ts                  # Zod 严格 schema
      scores.ts                  # 评分公式与统计口径
      standings.ts               # 排序与排名
      swiss.ts                   # 配对与轮次门禁
      finals.ts                  # 固定决赛图、BO3、奖项
      corrections.ts             # 更正影响面与处置
      validation.ts              # 结构化校验
    data/                        # 数据读取、缓存、派生视图模型
    operator/                    # 本地维护模式（不进入公开构建）
    styles/                      # 设计 token 与共享样式
  scripts/                       # seed / validate / import / build / 截图
  tests/
    domain/                      # 领域验收用例（D01–D18 等）
    fixtures/                    # 合成测试数据（绝不进入正式数据）
    e2e/                         # 端到端与设备矩阵
  .github/workflows/             # ci.yml、deploy.yml
```

---

## 当前完成状态

**仓库**：<https://github.com/ABlyh-LEO/RG26>（`main` 分支已推送）
**部署地址**（Pages 启用后）：<https://ablyh-leo.github.io/RG26/>

**已完成并验证：**

- ✅ 完整两日赛程（10 月 3–4 日），含比赛、核分、展示、抽签、开幕式、表演赛
- ✅ 22 队两轮排位赛（44 次跑图）与正式排名录入
- ✅ 16 队瑞士轮：战绩分组、评分、轮次确认、对阵公布、**R3 跨日锁定**
- ✅ 八强决赛固定对阵图、胜败流转、两组 BO3、名次结算
- ✅ **列式赛程图**：瑞士轮 R1–R5 → 决赛一条线，SVG 连线、战绩组分区、列数自适应、
  窄屏横向滚动（设计参考见 [`docs/reference/rm-schedule-ui-notes.md`](docs/reference/rm-schedule-ui-notes.md)）
- ✅ 队伍搜索、详情、本机关注、复制链接
- ✅ 本地维护工具：录入、校验、预览、确认、导入导出、发布前检查
- ✅ 排位赛：单场成绩更新后按「积分高者优，同分时用时短者优」**自动重排 1–22 名**，人工覆盖可选
- ✅ 排位赛原始成绩（44 次跑图）与名次一起公开：排位赛页总表 + 队伍详情页各自两轮
- ✅ GitHub Pages 工作流、数据更新提示、读取失败处理
- ✅ 167 个领域测试 + 120 个端到端测试
- ✅ 维护闭环集成演练（`npm run check:integration`）
- ✅ **仓库子路径部署验证**（`npm run check:subpath`）

**尚未完成（需要你操作或线下条件）：**

- ⏳ **Pages 尚未确认启用** —— 需要在仓库
  Settings → Pages → Source 选择 **GitHub Actions**，
  然后在 Actions 页面确认部署成功。步骤见
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §3。
  **推送成功不等于已上线。**
- ⏳ **未做实机验证** —— 自动化测试在 Chromium 内核（Edge）上完成，
  WebKit 因浏览器下载受限未运行。iOS Safari / Android Chrome / 现场网络需实测。
- ⏳ **无 Lighthouse 实测分数** —— 目标为性能 ≥90、可访问性 ≥95，尚未测量。

**规则上的已知不确定项**（不阻塞开发，运行前应补齐）：
见 [`docs/RULES.md`](docs/RULES.md) §8，以及 `data/event.json` 的 `event.openItems`。

**队名已确认：** 25 支队伍的队名均已按官方名单逐项核对（`nameVerified: true`），
界面上不再有待核对标记。

**场地：** 采用「主舞台 / 副场地A / 副场地B」三个名称。
主舞台用于所有两两对抗（瑞士轮、决赛），副场地A/B 仅用于排位赛跑图
（两块并行，每队两轮各用一个不同场地、互换）。
三个名称**已由组委会确认**，`provisionalName: false`，界面不再标注「暂定名称」。

完整验收证据见 [`docs/acceptance/ACCEPTANCE.md`](docs/acceptance/ACCEPTANCE.md)。

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/RULES.md`](docs/RULES.md) | 公式、赛制、统计口径、异常处理、原文未明确项 |
| [`docs/OPERATOR_GUIDE.md`](docs/OPERATOR_GUIDE.md) | 录入、确认、公布、抽签、更正、发布、回滚 |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | 仓库、Pages 设置、base 配置、Actions、排错、现场验证 |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | 完整实施计划与验收条件 |
| [`docs/acceptance/`](docs/acceptance/) | 验收记录与截图 |

---

## 关键约束（改代码前请先读）

1. **领域层是纯逻辑** —— `src/domain/` 不 import React，不读当前时间，
   不使用随机数（由 ESLint 强制）。当前时间一律由调用方传入。
2. **排序用原始精度** —— 页面显示两位小数，但比较必须用有理数原始值。
   绝不用 epsilon 把不等值视为相等。
3. **缺分不是 0** —— 不得用假 0 分填补缺失数据。
4. **不发明规则** —— 排位赛同分规则未提供，因此采用人工录入的裁判排名。
   瑞士轮不实现避重、随机或轮空。
5. **不静默改写历史** —— 更正通过新版本整体保存，旧记录保留并标记。
6. **公开产物必须干净** —— 维护模式代码不得进入公开构建。

---

## 许可与资料来源

原始赛程文档 `RoboGame2026赛程安排.docx`
（SHA256 `96C9C6B67CBD7E75E127D4126B36D166B583CB4F3DE6FD98AC532BD80BB18A47`）
的权威性见 [`docs/RULES.md`](docs/RULES.md) §1：
**所有时间仅供参考，具体情况以赛程组共享文档当天安排为准。**
