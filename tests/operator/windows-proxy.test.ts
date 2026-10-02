import { describe, expect, it } from 'vitest';
import { windowsProxyForUrl } from '../../scripts/operator/windows-proxy';
import { safeMessage } from '../../scripts/operator/errors';

describe('Windows 当前进程代理选择', () => {
  it('手动系统代理按 https 选择，不执行 PAC 解析', async () => {
    let called = false;
    const proxy = await windowsProxyForUrl('https://example.invalid/event/',
      async () => 'ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ http=proxy.example:8000;https=secure.example:9000',
      async () => { called = true; return null; });
    expect(proxy).toBe('http://secure.example:9000'); expect(called).toBe(false);
  });
  it('PAC-only 设置通过系统解析器按实际目标地址选择', async () => {
    const seen: string[] = [];
    const proxy = await windowsProxyForUrl('https://pages.example/event/data/event.json',
      async () => 'ProxyEnable REG_DWORD 0x0\nAutoConfigURL REG_SZ https://config.example/proxy.pac',
      async (target) => { seen.push(target); return 'http://automatic.example:9080/'; });
    expect(proxy).toBe('http://automatic.example:9080/');
    expect(seen).toEqual(['https://pages.example/event/data/event.json']);
  });
  it('系统判定目标直连时不将网站地址当作代理', async () => {
    expect(await windowsProxyForUrl('https://example.invalid/', async () => '', async (target) => target)).toBeNull();
  });
  it('读取失败、PAC超时及不支持的协议均可安全退回直连', async () => {
    expect(await windowsProxyForUrl('https://example.invalid/', async () => { throw new Error('registry unavailable'); },
      async () => { throw new Error('PAC timeout'); })).toBeNull();
    expect(await windowsProxyForUrl('https://example.invalid/', async () => '', async () => 'file:///private')).toBeNull();
  });
  it('错误日志隐藏HTTPS token和SOCKS代理凭据', () => {
    const message = safeMessage('failed https://secret-token@github.com/owner/repo socks5://user:password@proxy.invalid:9000');
    expect(message).not.toContain('secret-token'); expect(message).not.toContain('password');
    expect(message).toContain('https://[redacted]@github.com/owner/repo');
  });
});
