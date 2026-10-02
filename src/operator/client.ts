import { OPERATOR_API, type ApiError, type SessionResponse } from './contracts';

export class OperatorApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message); this.name = 'OperatorApiError';
  }
}

export class OperatorClient {
  private token = '';
  constructor(readonly clientId: string) {}
  async session(takeover = false): Promise<SessionResponse> {
    const response = await this.request<SessionResponse>('/session', 'POST', { clientId: this.clientId, takeover });
    this.token = response.token;
    return response;
  }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${OPERATOR_API}${path}`, { method, cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { 'X-Operator-Token': this.token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new OperatorApiError('无法连接本地服务。输入仍保留在此窗口，请恢复服务后重试保存。', 0, 'offline'); }
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = data as ApiError;
      throw new OperatorApiError(error.error?.message ?? `请求失败（${response.status}）`, response.status, error.error?.code ?? 'unknown', error.error?.details);
    }
    return data as T;
  }
}
