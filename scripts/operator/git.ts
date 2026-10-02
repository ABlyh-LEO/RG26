import { execFile } from 'node:child_process';
import { OperatorError, safeMessage } from './errors';
import type { GitState } from '../../src/operator/contracts';
import { windowsProxyForUrl } from './windows-proxy';

export const DATA_FILES = ['data/event.json', 'public/data/event.json'] as const;

export async function git(root: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {}): Promise<string> {
  // No shell: commit messages, paths and URLs never become executable command text.
  return new Promise((res, rej) => {
    const child = execFile('git', args, { cwd: root,
      // Even `git status` may refresh the index. Read-only checks must remain byte-for-byte read-only.
      env: { ...(options.env ?? process.env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8', timeout: options.timeout ?? 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    (error, stdout, stderr) => error ? rej(new OperatorError('GIT_FAILED', safeMessage(stderr || error.message), 409)) : res(args.includes('-z') ? stdout : stdout.trim()));
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}
async function maybeGit(root: string, args: string[]): Promise<string> { return git(root, args).catch(() => ''); }

export function githubCoordinates(remote: string): { owner: string; repo: string } | null {
  const match = /^(?:https:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}
export function inferPagesUrl(remote: string): string | null {
  const coordinates = githubCoordinates(remote);
  if (!coordinates) return null;
  const { owner, repo } = coordinates;
  return `https://${owner.toLowerCase()}.github.io/${repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : `${repo}/`}`;
}

export async function inspectGit(root: string, pagesOverride?: string): Promise<GitState> {
  const [head, branch, statusResult, remote] = await Promise.all([
    maybeGit(root, ['rev-parse', 'HEAD']), maybeGit(root, ['branch', '--show-current']),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      .then((raw) => ({ raw, error: null })).catch((error: unknown) => ({ raw: '', error: safeMessage(error) })),
    maybeGit(root, ['remote', 'get-url', 'origin']),
  ]);
  const entries = statusResult.raw.split('\0').filter(Boolean);
  const dirtyPaths: string[] = []; const stagedPaths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const status = entry.slice(0, 2); const path = entry.slice(3);
    dirtyPaths.push(path);
    if (status[0] !== ' ' && status !== '??') stagedPaths.push(path);
    if (/[RC]/.test(status)) { const previous = entries[++i]; if (previous) dirtyPaths.push(previous); }
  }
  const counts = (await maybeGit(root, ['rev-list', '--left-right', '--count', 'HEAD...refs/remotes/origin/main'])).split(/\s+/);
  const blockers: string[] = [];
  if (statusResult.error) blockers.push(`无法检查 Git 工作区或暂存区，不能确认是否可安全发布：${statusResult.error}`);
  if (!head) blockers.push('当前目录不是已提交的 Git 仓库。');
  if (branch !== 'main') blockers.push('发布必须在 main 分支；请先完成代码工作并切回 main。');
  if (!remote) blockers.push('尚未配置 origin 远端。');
  const unrelated = dirtyPaths.filter((path) => !DATA_FILES.includes(path as typeof DATA_FILES[number]) && !path.startsWith('.local/operator/'));
  if (unrelated.length) blockers.push(`存在与赛果无关的工作区修改：${unrelated.join('、')}。请先保存或提交这些工作。`);
  const stagedUnrelated = stagedPaths.filter((path) => !DATA_FILES.includes(path as typeof DATA_FILES[number]));
  if (stagedUnrelated.length) blockers.push(`暂存区包含无关文件：${stagedUnrelated.join('、')}，维护工具不会替你提交。`);
  return { branch, head: head || null, dirtyPaths, stagedPaths, ahead: Number(counts[0]) || 0, behind: Number(counts[1]) || 0,
    remote: remote ? safeMessage(remote) : null, pagesUrl: pagesOverride ?? inferPagesUrl(remote), blockers };
}

/** Honor explicit Git/env proxy settings first, then inspect Windows' current system setting. */
const systemProxies = new Map<string, { at: number; proxy: string | null }>();
export async function networkEnvironment(root: string, targetUrl = 'https://github.com'): Promise<{ env: NodeJS.ProcessEnv; proxy: string | null; source: string }> {
  const env = { ...process.env };
  const configured = await git(root, ['config', '--get-urlmatch', 'http.proxy', targetUrl]).catch(() => null);
  const inherited = env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (configured !== null) {
    if (!configured) { env.HTTPS_PROXY = ''; env.HTTP_PROXY = ''; env.ALL_PROXY = ''; env.https_proxy = ''; env.http_proxy = ''; env.all_proxy = ''; }
    return { env, proxy: configured || null, source: configured ? 'Git 代理设置' : 'Git 已明确禁用代理' };
  }
  if (inherited) return { env, proxy: inherited, source: '进程代理设置' };
  if (process.platform !== 'win32') return { env, proxy: null, source: '直连' };
  try {
    const destination = new URL(targetUrl);
    const target = `${destination.origin}${destination.pathname}`;
    let cached = systemProxies.get(target);
    if (!cached || Date.now() - cached.at >= 60_000) {
      cached = { at: Date.now(), proxy: await windowsProxyForUrl(targetUrl) }; systemProxies.set(target, cached);
    }
    const proxy = cached.proxy;
    if (!proxy) return { env, proxy: null, source: '直连（系统代理未指定此目标）' };
    env.HTTPS_PROXY = proxy; env.HTTP_PROXY = proxy;
    return { env, proxy, source: '当前 Windows 系统代理（仅本次进程）' };
  } catch { return { env, proxy: null, source: '直连' }; }
}

export async function fetchRemote(root: string): Promise<void> {
  const network = await networkEnvironment(root);
  await git(root, ['fetch', '--no-tags', 'origin', 'main'], { env: network.env, timeout: 60_000 });
}
