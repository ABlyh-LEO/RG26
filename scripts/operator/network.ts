import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkEnvironment } from './git';

const execute = promisify(execFile);
export interface JsonResponse { status: number; data: unknown }
/** curl uses the detected proxy per invocation; no global Git/system settings are changed. */
export async function readRemoteJson(root: string, url: string): Promise<JsonResponse> {
  const address = new URL(url);
  if (address.protocol !== 'https:') throw new Error('远端检查仅支持 HTTPS');
  const network = await networkEnvironment(root, address.href);
  const args = ['--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '15',
    '--header', 'Accept: application/json', '--header', 'User-Agent: RG26-local-operator',
    '--write-out', '\n%{http_code}', ...(network.proxy ? ['--proxy', network.proxy] : []), address.href];
  const { stdout } = await execute(process.platform === 'win32' ? 'curl.exe' : 'curl', args,
    { env: network.env, encoding: 'utf8', windowsHide: true, timeout: 18_000, maxBuffer: 4 * 1024 * 1024 });
  const separator = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(separator + 1));
  let data: unknown;
  try { data = JSON.parse(stdout.slice(0, separator)); } catch { data = null; }
  return { status, data };
}
