export class OperatorError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = 'OperatorError';
  }
}

export function safeMessage(error: unknown): string {
  // Do not expose credentials potentially embedded in a Git remote/proxy URL.
  return (error instanceof Error ? error.message : String(error))
    .replace(/((?:https?|socks5h?|socks4a?):\/\/)[^\s/@]+@/gi, '$1[redacted]@');
}
