import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
async function readSettings(): Promise<string> {
  const { stdout } = await execute('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
    { encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  return stdout;
}
async function systemProxy(targetUrl: string): Promise<string | null> {
  // GetSystemWebProxy also resolves PAC/automatic detection. Pass the destination through the
  // child's environment so URL text never becomes PowerShell source or a shell argument.
  const script = "$ErrorActionPreference='Stop'; $target=[Uri]$env:RG26_PROXY_TARGET_URL; $proxy=[Net.WebRequest]::GetSystemWebProxy(); $resolved=$proxy.GetProxy($target); if($resolved -and $resolved.AbsoluteUri -ne $target.AbsoluteUri){$resolved.AbsoluteUri}";
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { env: { ...process.env, RG26_PROXY_TARGET_URL: targetUrl }, encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  return stdout.trim() || null;
}

/** Injection makes the PAC-only and direct-connection branches testable without changing user settings. */
export async function windowsProxyForUrl(targetUrl: string, read = readSettings, resolve = systemProxy): Promise<string | null> {
  const settings = await read().catch(() => '');
  let candidate: string | null = null;
  if (/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(settings)) {
    const raw = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(settings)?.[1]?.trim();
    if (raw) candidate = /(?:^|;)https=([^;]+)/i.exec(raw)?.[1] ?? /(?:^|;)http=([^;]+)/i.exec(raw)?.[1] ?? raw;
  }
  if (!candidate) candidate = await resolve(targetUrl).catch(() => null);
  if (!candidate) return null;
  const proxy = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  try {
    const parsed = new URL(proxy);
    if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || parsed.href === new URL(targetUrl).href) return null;
    return proxy;
  } catch { return null; }
}
