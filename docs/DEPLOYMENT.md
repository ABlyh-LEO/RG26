# 部署指南

本文供技术维护者配置 GitHub Pages、路径、Actions 与故障恢复。现场录入和日常发布请从 [维护者操作手册](OPERATOR_GUIDE.md#quick-start) 开始；无需按本文每次重新部署或手工提交赛果。

- **仓库**：<https://github.com/ABlyh-LEO/RG26>
- **目标地址**：<https://ablyh-leo.github.io/RG26/>
- **验收证据**：[界面与更新流程升级验收](acceptance/2026-10-02-experience-upgrade.md)、[维护工作台验收](acceptance/operator-upgrade.md)。远端运行状态以对应提交的 [GitHub Actions](https://github.com/ABlyh-LEO/RG26/actions) 和公开快照为准。

---

## 0 网络与代理

工作台和兼容的 `npm run publish` 命令复用已有 Git 登录，不保存仓库令牌。运行时依次读取目标 URL 对应的 Git 代理配置、进程代理环境变量；Windows 下还会检查当前系统代理，并在需要时按目标地址解析系统自动配置/PAC。

检测到的系统代理只传给本次子进程，不写入仓库、全局 Git 或系统设置，也不内置任何个人代理端口。Git 中明确禁用代理的配置会被尊重。普通终端直接执行 `git push` / `git pull` 仍遵循该终端自己的配置，不保证继承工作台的代理选择。

换电脑或网络后，先检查当前 Git 凭据与网络条件。连接失败时在任务日志查看具体阶段；已提交的发布可在网络恢复后重推同一提交。重试不保证能解决配置错误或网络限制。

GitHub API 返回限流或暂不可访问时，工作台会显示“部署状态暂不可查询”，并继续核对公开快照。只有本次 revision 与 sourceCommit 同时匹配，才确认观众可见。首次网络排错和真实远端结果记录在对应验收文档中，不应当作其他机器的固定配置。

---

## 1 前置条件

| 项目 | 说明 |
| --- | --- |
| Node | 支持 `>=22.12 <25`，推荐 `.nvmrc` 中的 Node 24；CI 使用 `.nvmrc`。Windows 启动器会先检查版本。 |
| Git | 已安装且在 PATH 中可执行，已设置提交身份和远端访问权限。Windows 启动器会先检查可用性。 |
| 仓库 | 已检出目标仓库，并核对 origin、main 分支和工作区状态。 |
| 权限 | 能修改仓库 Settings → Pages |

已有仓库无需重复初始化；检查 Pages 的 Source 设置，并核对本次提交的部署结果。

---

## 2 部署形态与 base 路径

Vite 的 `base` 必须与真实部署目标一致，否则静态资源与数据都会 404。

| 部署目标 | URL 形式 | `VITE_BASE_PATH` |
| --- | --- | --- |
| **项目站**（最常见） | `https://<owner>.github.io/<repo>/` | `/<repo>/` |
| 用户站 | `https://<owner>.github.io/` | `/` |
| 自定义域名 | `https://example.com/` | `/` |

**注意**：不要把本地目录名当成实际 repo 名。
`deploy.yml` 中已使用 `github.event.repository.name` 自动取值。

### 本地验证两种 base

```bash
# 根路径
npm run build && npm run preview

# 仓库子路径
VITE_BASE_PATH=/test-repo/ npm run build
node scripts/serve-subpath.mjs --base /test-repo/ --port 4173
```

两种情况下都要检查：

- 首页能打开
- `data/event.json` 能加载（打开开发者工具 Network 确认 200）
- **深链刷新不 404**：打开 `#/teams/competitive-18` 后按 F5

> 路由使用 **hash 模式**（`HashRouter`），因此深链刷新不会触发 GitHub 的 404，
> 不需要服务端重写规则。

自动化测试也必须使用同一个前缀。以下命令以已有产物为准，不重新构建：

```bash
E2E_SKIP_BUILD=1 E2E_BASE_URL=http://127.0.0.1:4173/test-repo/ npm run test:e2e
```

以上环境变量语法适用于 Bash；PowerShell 可先设置
`$env:E2E_SKIP_BUILD='1'` 和 `$env:E2E_BASE_URL='http://127.0.0.1:4173/test-repo/'`，
再运行 `npm run test:e2e`。省略 `E2E_SKIP_BUILD` 时，测试会按 `E2E_BASE_URL`
对应的 base 自动构建。CI 和部署工作流都设为 `1`，确保测试的文件就是待上传的文件。

`vite preview` 同样支持子路径，但会在启动时重新读取 Vite 配置。
只给之前的构建命令设置 `VITE_BASE_PATH`，不会让后续的 preview 自动继承它；
使用 preview 时需同时设置该变量。E2E 使用上面的静态服务，对不存在的 JS、JSON
和维护页面返回 404，避免 SPA 回退返回 HTML 掩盖资源路径错误。

---

## 3 首次上线步骤

### 3.1 初始化仓库并推送（仅新建仓库）

```bash
git init
git add .
git commit -m "初始提交：RoboGame2026 赛程可视化工具"
git branch -M main
git remote add origin https://github.com/ABlyh-LEO/RG26.git
git push -u origin main
```

> `.gitignore` 已排除 `node_modules/`、`dist/`、`.npm-cache/`、`test-results/`。
> `.gitattributes` 统一为 LF，避免 Windows 提交 CRLF 导致 CI 整文件差异。
> `data/event.json` **必须提交**（它是正式输入）；
> `public/data/event.json` 是生成产物，但也提交了，方便直接查看。

### 3.2 检查 Pages 设置

打开 <https://github.com/ABlyh-LEO/RG26/settings/pages>，
**Source 选择 `GitHub Actions`**。

> 不要选「Deploy from a branch」——本项目使用自定义工作流。

### 3.3 触发部署

推送到 `main` 会自动触发 `deploy.yml`
（当 `data/event.json`、`src/**`、`public/**` 等路径变化时）。

也可在 **Actions → Deploy to GitHub Pages → Run workflow** 手动触发。

> **若首次运行在你启用 Pages 之前就已经失败**，启用后打开那次失败的 run，
> 点 **Re-run all jobs** 即可，不必重新提交。

### 3.4 确认部署成功

Actions 页面应看到两个 job：

1. **build** —— 类型检查、Lint、测试、数据校验、构建、产物检查
2. **deploy** —— 上传并部署，随后自动检查首页与公开 JSON

部署后检查会验证：

- 首页可读且包含 `RoboGame2026`
- `data/event.json` 可读、可解析、`schemaVersion === 1`
- 公开 revision 与 build job 输出的目标 revision 完全一致
- 公开 sourceCommit 与本次 `GITHUB_SHA` 完全一致

检查使用 cache-bust，允许 CDN 在最多 180 秒内传播；网络、HTTP、结构或版本检查在预算内未通过时，工作流失败。GitHub 部署 action 成功不代替这一步核验。

### 3.5 手动核对实际 Pages 子路径

自动检查用的是 `page_url`。**再手动打开一次实际地址**：

```
https://<owner>.github.io/<repo>/
```

确认首页与数据都正常，并抽查一个深链。

---

## 4 工作流说明

### `ci.yml`（PR 与 main push）

按顺序执行，任一失败会使检查失败；要强制阻止合并，须将该检查设为分支保护的必需检查：

```
npm ci → typecheck → lint → test → validate:data → build → 观众端 e2e → 维护端 e2e
```

### `deploy.yml`（main push 或手动）

- **权限**：`contents: read`、`pages: write`、`id-token: write`
- **environment**：`github-pages`
- **并发**：`group: pages`、`cancel-in-progress: false`
  —— 同一站点**串行化部署**，避免旧版本后完成而覆盖新版本
- **产物检查**：显式拒绝 `dist/operator.html` 存在

> **数据校验或规则测试失败必须阻止部署** —— 这是刻意的设计。

### 依赖版本

工作流使用官方 action（`actions/checkout`、`actions/setup-node`、
`actions/configure-pages`、`actions/upload-pages-artifact`、`actions/deploy-pages`）。

> 依赖版本已在工作流中固定为主版本标签。
> 若要锁定到提交 SHA 以进一步提高可复现性，可在实施时替换为具体 SHA。

---

## 5 数据发布流程

日常发布见 [维护者操作手册：核对、预览与发布](OPERATOR_GUIDE.md#publish)。右上角“预览与发布”和左侧“发布记录”进入同一页面。要点：

```
本地录入与自动保存草稿 → 核对累计变更 → 冻结观众预览 → 确认发布 → commit → push → Pages 部署 → 核对公开版本
```

**关键区分：**

| 事件 | 含义 |
| --- | --- |
| 草稿已保存 | 输入已保存在 `.local/operator/`，观众尚不可见 |
| commit 成功 | 本地历史已记录 |
| push 成功 | 远端已收到 |
| Pages 部署 action 成功 | 产物已交给托管服务，继续检查公开版本 |
| **公开 revision 与 sourceCommit 同时匹配本次发布** | **本次版本已可见** |

---

## 6 限制与预期

- GitHub Pages 提供静态托管；本项目的维护服务在本机运行。
- 部署需要构建、检查、上传和缓存传播，平台配额以实际账户与 GitHub 规定为准。
- **不能承诺固定延迟**。观众页面每 60 秒检查一次新数据，因此「确认成绩后几分钟内更新」是合理预期，
  而不是秒级。

---

## 7 排错

### 页面打开但数据加载失败

1. 打开开发者工具 Network，确认 `data/event.json` 的**状态码与请求路径**。
2. 若 404：检查 `VITE_BASE_PATH` 是否与部署目标一致（§2）。
3. 若 200 但页面报「数据结构与当前版本不兼容」：
   说明公开数据的 schema 与前端代码不匹配，需要重新构建部署。
4. 若路径是根路径 `/data/event.json` 而不是子路径：
   说明构建时 base 配置错误。

**客户端行为**：读取失败会保留最近一次成功的快照，
并显示「暂时无法更新」与旧快照时间。首次读取失败且无缓存时显示重试入口。

### Actions 部署失败

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `validate:data` 失败 | 数据有错误 | 本地运行 `npm run validate:data` 查看具体条目并修复 |
| 「存在未处置的更正」 | `corrections` 有 `pending` | 完成[更正处置流程](OPERATOR_GUIDE.md#results) |
| 「公开产物中不应包含维护模式入口」 | 构建配置被改坏 | 检查 `vite.config.ts` 的 `input` 逻辑 |
| `test` 失败 | 领域算法回归 | 本地 `npm run test` 定位 |
| Pages 权限错误 | 权限或 environment 配置不对 | 确认 `permissions` 与 `environment: github-pages` |
| 「180 秒内未确认本次部署」 | 网络、CDN 或公开版本尚不匹配 | 核对日志中的 revision/sourceCommit、实际 Pages 地址和 HTTP 状态；处理后重跑，不绕过双字段检查 |

### 深链刷新出现 GitHub 404

几乎总是因为路由模式被改成了 history 模式。

**处理**：确认使用 `HashRouter`（`src/main.tsx`）。
若确实需要 history 模式，必须额外提供 404 回退方案。

### 部署成功但观众仍看到旧数据

1. 确认公开页面的**数据更新时间**是否变化。
2. 让观众点「立即刷新」或等待 60 秒。
3. 检查是否命中 CDN 缓存；等待几分钟。
4. 若确认是新版本但内容未变，检查是否只是 `builtAt` 变化而 `revision` 未变
   —— 这种情况下客户端只更新发布元信息，**不替换赛事内容**（这是预期行为）。

### 回滚

见 [操作手册：技术命令与紧急回退](OPERATOR_GUIDE.md#cli)。**用新 commit 发布，不要 reset 历史。**

---

## 8 现场可用性验证

**部署完成后、比赛开始前**，必须用真实条件验证：

- [ ] 用**实际观众设备**（手机为主）打开公开站点
- [ ] 在**比赛场地网络**下测试首屏加载时间
- [ ] 测试刷新与深链分享
- [ ] 记录实际测得的加载时间与是否可用

> **只报告实测结果**，不保证 GitHub Pages 在所有网络都能稳定访问。
> 若现场实测访问质量不足，同一 `dist` 可迁移到其他静态托管平台
> —— 届时由实际结果决定，**不预先引入双平台维护**。

---

## 9 安全边界

公开产物**不得**包含：

- 本地维护草稿
- 工作人员记录
- 仓库凭据
- 原始文档下载入口（除非用户明确要求公开）

已验证的隔离机制：

1. 公开构建的 `rollupOptions.input` **只有 `index.html`**，
   维护入口 `operator.html` 只存在于 `--mode operator` 构建。
2. CI 与部署工作流显式检查 `dist/operator.html` 不存在。
3. 公开 bundle 中不含维护界面独有标识
   （由 e2e 测试「公开产物中不包含维护模式界面代码」验证）。
4. 维护工具只监听 `127.0.0.1`，公开站点**没有任何写入能力**。
5. 本地写入还会校验 Host、Origin、会话 token 和编辑会话；公开站点不提供这些 API。
