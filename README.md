# RoboGame2026 赛事网站与本地工作台

观众网站展示赛程、已确认结果、排名和晋级关系，支持手机查看、队伍关注与深链。网站以 React、TypeScript 和 Vite 构建，部署到 GitHub Pages；维护者在本机工作台录入、核对预览并统一发布。

正式数据源为 `data/event.json`。当前赛程和规则来自 `docs/` 下的赛程 DOCX 与竞技规则 PDF，见 [规则说明](docs/RULES.md)。根目录旧赛程仅保留作历史资料。

## 启动

安装 Git 和 `.nvmrc` 指定的 Node.js 版本，首次运行：

```bash
npm ci
npm run operator
```

Windows 也可双击 `start-operator.cmd`。工作台在 `http://127.0.0.1:5199/operator.html` 自动打开，只接受本机访问。根地址为观众页面；公开生产构建不包含维护入口或写入能力。

日常更新：在赛事工作台录入 → 等待草稿自动保存 → “预览与发布”核对累计变更和观众预览 → 确认发布 → 等待“观众已可见”。无需导出 JSON 或另开终端提交。

草稿、未完成输入和发布任务保存在被 Git 忽略的 `.local/operator/`，重启可以恢复。发布只提交赛事数据文件；提交前失败会恢复原文件，提交后推送失败则保留提交并重推同一 SHA。Pages 需要几分钟部署，工作台根据公开快照的 revision 与 sourceCommit 核验本次版本是否可见。

完整操作步骤、交接、更正与故障恢复见 [维护者手册](docs/operator-guide.md)。首次部署配置见 [部署说明](docs/DEPLOYMENT.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run operator` | 本机赛事工作台、持久草稿与发布服务 |
| `npm run dev` | 观众站开发服务器 |
| `npm run typecheck` / `npm run lint` | 类型和代码检查 |
| `npm test` | 领域、静态服务与维护发布事务测试 |
| `npm run test:e2e` | 生产构建的端到端设备检查 |
| `npm run validate:data` | 校验唯一正式源 |
| `npm run data:build` | 生成公开快照 |
| `npm run build` | 校验、生成快照、类型检查和公开构建 |
| `npm run preview` | 本地查看公开构建 |
| `npm run check:subpath` | 仓库子路径部署验证 |
| `npm run check:integration` / `npm run check:robustness` | 合成完整赛季与异常场景检查 |
| `npm run publish -- --file <变更包.json> --dry-run` | 兼容变更包的只读发布检查 |
| `npm run publish -- --retry <任务ID>` | 继续推送已经提交的任务 |

`npm run data:seed` 仅用于生成初始骨架；已有赛事数据时不要执行初始化。完整工作台草稿备份与命令行变更包的格式不同，见维护者手册。

## 项目结构

```text
 data/event.json               唯一正式输入
 public/data/event.json        构建生成的公开快照
 docs/                         当前赛程、规则、维护/部署手册与验收记录
 src/app, components, pages/    观众站布局与视图
 src/domain/                   纯领域规则、校验与依赖推导
 src/data/                     快照读取、缓存与视图模型
 src/operator/                 本地维护界面与共享接口类型
 scripts/operator/             草稿、会话、Git发布事务及上线核验
 scripts/operator-server.ts    同源本机 API + Vite 服务
 .local/operator/              本机持久状态（不提交）
 tests/domain, operator, e2e/   规则、发布事务及界面验收
 .github/workflows/            CI 与 Pages 部署
```

## 开发约束

- 领域层保持纯逻辑，不读当前时间或随机值；时间由调用方传入。
- 排序使用有理数原始精度，缺分不能用零分代替。
- 胜者由裁判确认，软件不擅自发明赛制、轮空或判罚。
- 已公布结果的更正保留旧值、原因和下游处置，不能静默覆盖历史。
- 公开构建不得包含维护界面或本地服务代码。
- 页面只显示已经确认的信息；计划时间不代表实际开赛状态。

## 文档与站点

- [规则与来源](docs/RULES.md)
- [维护者操作手册](docs/operator-guide.md)
- [GitHub Pages 部署说明](docs/DEPLOYMENT.md)
- [历史实施计划](docs/IMPLEMENTATION_PLAN.md)
- [验收记录](docs/acceptance/)
- [公开赛事网站](https://ablyh-leo.github.io/RG26/)
- [GitHub 仓库](https://github.com/ABlyh-LEO/RG26)
