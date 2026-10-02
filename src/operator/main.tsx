/**
 * 本地维护模式（docs/IMPLEMENTATION_PLAN.md 第 10 节）。
 *
 * 安全边界：
 * - 只在 127.0.0.1 启动（见 vite.config.ts 的 server.host）。
 * - 生产构建通过独立的 operator.html 入口**不包含**本模块，
 *   公开站点没有任何结果写入能力，也不靠前端密码假装鉴权。
 * - 草稿只保存在本机；正式数据只能来自通过校验并发布的快照。
 */
import { createRoot } from 'react-dom/client';
import { OperatorApp } from './OperatorApp';
import { PreviewHost } from './PreviewFrame';
import '../styles/tokens.css';
import '../styles/app.css';
import '../styles/bracket.css';
import './operator.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

createRoot(container).render(new URLSearchParams(window.location.search).has('preview') ? <PreviewHost /> : <OperatorApp />);
