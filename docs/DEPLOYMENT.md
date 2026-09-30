# 部署指南

说明如何把本站部署到 GitHub Pages，以及路径配置、Actions、
首次上线步骤和常见排错。

- **仓库**：<https://github.com/ABlyh-LEO/RG26>
- **目标地址**：<https://ablyh-leo.github.io/RG26/>
- **当前状态**：`main` 已推送（commit `0ddbdc3`）；**Pages 是否启用与部署是否成功尚未确认**

---

## 0 当前网络环境（本机实测）

推送这个仓库时遇到的实际情况，供换机器时参考：

| 方式 | 实测 | 说明 |
| --- | --- | --- |
| SSH `git@github.com:22` | ❌ 连接超时 | 端口被网络阻断 |
| SSH over 443（`ssh.github.com:443`） | ⚠️ 可连通 | 但密钥未授权（`Permission denied (publickey)`） |
| **HTTPS + 代理** | ✅ **可用** | 本仓库已配置，`push` 成功 |
| GitHub REST API | ❌ 403 | 无法用 API 读 Actions 状态，需在网页查看 |

本仓库已设置代理，后续 `push` / `pull` **无需额外参数**：

```bash
git config --get http.proxy      # http://127.0.0.1:7890
git config --get https.proxy     # http://127.0.0.1:7890
```

代理偶发 `SSL_ERROR_SYSCALL`，**重试即可成功**。

> 换到无代理网络时清除：`git config --unset http.proxy && git config --unset https.proxy`
>
> 若想改用 SSH，先把公钥（`~/.ssh/id_rsa.pub`）加到
> <https://github.com/settings/keys>，并在 `~/.ssh/config` 里加：
> ```
> Host github.com
>   HostName ssh.github.com
>   Port 443
>   User git
> ```
> 然后 `git remote set-url origin git@github.com:ABlyh-LEO/RG26.git`

---

## 1 前置条件

| 项目 | 说明 |
| --- | --- |
| Node | 见 `.nvmrc`（当前为 24）。CI 使用同一版本。 |
| 仓库 | <https://github.com/ABlyh-LEO/RG26> —— **已创建，`main` 已推送** |
| 权限 | 能修改仓库 Settings → Pages |

> 仓库已就绪，**§3.1 的初始化步骤已经完成**，你只需做 §3.2 起的两件事：
> 启用 Pages（Source 选 GitHub Actions）并确认部署成功。

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
VITE_BASE_PATH=/test-repo/ npm run build && npm run preview
```

两种情况下都要检查：

- 首页能打开
- `data/event.json` 能加载（打开开发者工具 Network 确认 200）
- **深链刷新不 404**：打开 `#/teams/competitive-18` 后按 F5

> 路由使用 **hash 模式**（`HashRouter`），因此深链刷新不会触发 GitHub 的 404，
> 不需要服务端重写规则。

---

## 3 首次上线步骤

### 3.1 初始化仓库并推送 —— ✅ 已完成

```bash
git init
git add .
git commit -m "初始提交：RoboGame2026 赛程可视化工具"
git branch -M main
git remote add origin https://github.com/ABlyh-LEO/RG26.git
git push -u origin main
```

**实际结果**：`main` → commit `0ddbdc3ca8b0a7a0fc6ac5f8d765d2d61a364811`，
已用 `git ls-remote` 核对远端一致。共 87 个文件。

> `.gitignore` 已排除 `node_modules/`、`dist/`、`.npm-cache/`、`test-results/`。
> `.gitattributes` 统一为 LF，避免 Windows 提交 CRLF 导致 CI 整文件差异。
> `data/event.json` **必须提交**（它是正式输入）；
> `public/data/event.json` 是生成产物，但也提交了，方便直接查看。

### 3.2 启用 Pages —— ⏳ 需要你操作

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

### 3.5 手动核对实际 Pages 子路径

自动检查用的是 `page_url`。**再手动打开一次实际地址**：

```
https://<owner>.github.io/<repo>/
```

确认首页与数据都正常，并抽查一个深链。

---

## 4 工作流说明

### `ci.yml`（PR 与 main push）

按顺序执行，任一失败即阻止合并：

```
npm ci → typecheck → lint → test → validate:data → build → e2e
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

日常发布见 [`OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md) §9。要点：

```
本地录入 → 导出变更包 → npm run data:import → validate:data → commit → push → Actions 部署
```

**关键区分：**

| 事件 | 含义 |
| --- | --- |
| 导入成功 | 本机 `data/event.json` 已更新 |
| commit 成功 | 本地历史已记录 |
| push 成功 | 远端已收到 |
| **Actions 部署成功** | **公开快照已生成并上传** |
| **公开页面 revision 变化** | **观众已可见** |

---

## 6 限制与预期

来自 GitHub 官方文档的约束：

- 发布的站点大小上限 **1 GB**，月带宽软限制 **100 GB**
  —— 本项目远低于此规模（公开数据约 120 KB，JS 约 93 KB gzip）。
- 使用**自定义 Actions 工作流**可避免 Pages 默认每小时 10 次构建软限制的适用情形，
  但仍存在**部署耗时、平台配额和缓存传播**。
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
| 「存在未处置的更正」 | `corrections` 有 `pending` | 完成处置流程（见操作手册 §10） |
| 「公开产物中不应包含维护模式入口」 | 构建配置被改坏 | 检查 `vite.config.ts` 的 `input` 逻辑 |
| `test` 失败 | 领域算法回归 | 本地 `npm run test` 定位 |
| Pages 权限错误 | 权限或 environment 配置不对 | 确认 `permissions` 与 `environment: github-pages` |

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

见操作手册 §12。**用新 commit 发布，不要 reset 历史。**

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
5. **不靠前端密码假装鉴权** —— 靠的是构建期剔除，而不是运行时判断。
