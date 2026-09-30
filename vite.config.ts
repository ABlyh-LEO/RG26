import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Vite base 必须按真实部署目标设置（docs/DEPLOYMENT.md）。
 * 项目站 https://<owner>.github.io/<repo>/ 用 /<repo>/；
 * 用户站或自定义域名根目录用 /。
 * 通过 VITE_BASE_PATH 环境变量注入，默认 '/'，绝不把本地目录名当成 repo 名。
 */
export function resolveBase(mode: string, env: Record<string, string | undefined>): string {
  if (mode === 'operator') return '/';
  const raw = env.VITE_BASE_PATH;
  if (!raw || raw.trim() === '' || raw.trim() === '/') return '/';
  const trimmed = raw.trim();
  return trimmed.startsWith('/') ? (trimmed.endsWith('/') ? trimmed : `${trimmed}/`) : `/${trimmed}/`;
}

export default defineConfig(({ mode }) => {
  const isOperator = mode === 'operator';
  // 公开构建绝不包含维护模式代码；维护入口只在独立 HTML 入口下存在。
  const input: Record<string, string> = isOperator
    ? { index: resolve(__dirname, 'index.html'), operator: resolve(__dirname, 'operator.html') }
    : { index: resolve(__dirname, 'index.html') };

  return {
    base: resolveBase(mode, process.env),
    plugins: [react()],
    build: {
      outDir: 'dist',
      rollupOptions: { input },
      sourcemap: false,
    },
    server: {
      host: '127.0.0.1',
      port: isOperator ? 5199 : 5173,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
    },
  };
});
