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
export type PublishStatus = 'checking' | 'saving' | 'committing' | 'committed' | 'pushing' | 'deploying' | 'live' | 'failed';
export interface PublishJob {
  id: string;
  status: PublishStatus;
  phase: Exclude<PublishStatus, 'failed'>;
  createdAt: string;
  updatedAt: string;
  previewId: string;
  draftVersion: number;
  targetRevision: string;
  commit: string | null;
  message: string;
  logs: DraftLog[];
  error: string | null;
  retryable: boolean;
  pagesUrl: string | null;
  actionsUrl: string | null;
  workflowConclusion: string | null;
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
