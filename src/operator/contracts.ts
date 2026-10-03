/** Shared wire types for the localhost workbench. Never imported by the public entry. */
import type { EventFile, PublicSnapshot } from '../domain/schema';

export const OPERATOR_API = '/api/operator';
export type FormInputs = Record<string, Record<string, string | number | boolean | null>>;
export interface DraftLog { id: string; at: string; message: string }
export interface ChangeSummary { path: string; label: string; before: string; after: string }
export interface DraftEnvelope {
  version: number;
  baseRevision: string;
  baseCommit: string | null;
  event: EventFile;
  formInputs: FormInputs;
  logs: DraftLog[];
  dirty: boolean;
  updatedAt: string;
  migrationRequiresReview: boolean;
}
export interface SourceState { revision: string; commit: string | null; event: EventFile }
export interface GitState {
  branch: string;
  head: string | null;
  dirtyPaths: string[];
  stagedPaths: string[];
  ahead: number;
  behind: number;
  remote: string | null;
  pagesUrl: string | null;
  blockers: string[];
}
export interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  changes: ChangeSummary[];
  sourceRevision: string;
  git: GitState;
}
export interface FrozenPreview {
  id: string;
  draftVersion: number;
  baseRevision: string;
  targetRevision: string;
  expectedHead: string;
  createdAt: string;
  snapshot: PublicSnapshot;
  changes: ChangeSummary[];
  warnings: string[];
}
export type PublishStatus = 'checking' | 'saving' | 'committing' | 'committed' | 'pushing' | 'deploying' | 'live' | 'unverified' | 'failed';
/**
 * 已推送后等待"观众可见"确认的最长时间（2 分钟）。
 *
 * 超过它就不再阻塞下一批发布：部署失败时公开站点永远不会出现该版本，而
 * GitHub API 又可能限流查不到结论（"部署状态暂不可查询"），两者叠加会让任务
 * 永久停在 deploying，把整个发布流程锁死。这类任务会被落成 `unverified`
 * （已推送、未核验），既不假装成功，也不假装失败。
 *
 * 注意：2 分钟通常**短于**一次 Pages 部署（约 3–4 分钟），因此正常成功的发布
 * 也会先经过"未核验"这一状态；后台仍会继续核验这类任务，公开站点一旦返回
 * 本次版本就会自动变成"观众已可见"（见 `checkPending`）。
 */
export const VERIFY_GRACE_MS = 2 * 60_000;
export interface PublishJob {
  id: string;
  status: PublishStatus;
  /** 进行阶段；`failed` 与 `unverified` 是终态，没有对应的进行阶段。 */
  phase: Exclude<PublishStatus, 'failed' | 'unverified'>;
  createdAt: string;
  updatedAt: string;
  previewId: string;
  draftVersion: number;
  targetRevision: string;
  commit: string | null;
  /**
   * 推送成功的时间（ISO）。用于判断"等核验"是否已经超时；
   * 旧任务没有这个字段时按 `updatedAt` 估算。
   */
  pushedAt?: string | null;
  message: string;
  logs: DraftLog[];
  error: string | null;
  retryable: boolean;
  pagesUrl: string | null;
  actionsUrl: string | null;
  workflowConclusion: string | null;
}

/**
 * 任务进入"已推送，等待部署"的时间（毫秒）；旧任务没有 `pushedAt` 时回退到
 * 进入该状态的那条日志时间。
 *
 * **不能用 `updatedAt`**：它会被"检查上线状态"轮询刷新，拿它判断超时永远不会超时，
 * 于是任务又会永久卡住（这正是本次要修的问题）。前端与后端共用这一个判定。
 */
export function pushedAtMs(job: Pick<PublishJob, 'pushedAt' | 'createdAt' | 'logs'>): number | null {
  if (job.pushedAt) {
    const parsed = Date.parse(job.pushedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const entry = job.logs.find((log) => log.message.includes('已推送，等待 Pages 部署'));
  if (entry) {
    const parsed = Date.parse(entry.at);
    if (Number.isFinite(parsed)) return parsed;
  }
  const created = Date.parse(job.createdAt);
  return Number.isFinite(created) ? created : null;
}
export interface OperatorState {
  source: SourceState;
  draft: DraftEnvelope;
  preview: FrozenPreview | null;
  jobs: PublishJob[];
  git: GitState;
  readOnly: boolean;
}
export interface SessionResponse extends OperatorState {
  token: string;
  sessionId: string;
}
export interface SessionRequest { clientId: string; takeover?: boolean }
export interface SaveDraftRequest {
  expectedVersion: number;
  event: EventFile;
  formInputs?: FormInputs;
  message?: string;
  migrationRequiresReview?: boolean;
}
export interface VersionRequest { expectedVersion: number }
export interface PublishRequest extends VersionRequest { previewId: string; message?: string }
export interface ApiError { error: { code: string; message: string; details?: unknown } }

/**
 * JSON routes; every /api/operator request is checked for loopback Host and Origin.
 * POST /session {clientId,takeover?} -> SessionResponse (active other client: readOnly=true).
 * All other routes require X-Operator-Token; a superseded session remains read-only.
 * GET /state -> OperatorState
 * PUT /draft SaveDraftRequest -> DraftEnvelope
 * POST /draft/reset VersionRequest -> DraftEnvelope (explicitly discard current draft)
 * POST /sync VersionRequest -> OperatorState (clean draft + clean Git; fetch/ff only)
 * POST /validate VersionRequest -> PreflightResult (no file writes)
 * POST /preview VersionRequest -> FrozenPreview (validate and freeze; no source writes)
 * POST /publish PublishRequest -> PublishJob (202, asynchronously persists stages)
 * GET /jobs -> PublishJob[]
 * POST /jobs/:id/retry {} -> PublishJob (same commit after a push failure)
 * POST /jobs/:id/check {} -> PublishJob (check workflow + public snapshot once)
 * Errors use HTTP 409 for stale version/source, 403 for read-only sessions.
 */
