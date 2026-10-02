export interface PagesVerificationOptions {
  pageUrl: string;
  expectedRevision: string;
  expectedCommit: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<unknown>;
  log?: (message: string) => unknown;
}

export function verifyPublishedSite(options: PagesVerificationOptions): Promise<{
  attempts: number;
  revision: string;
  sourceCommit: string;
}>;
