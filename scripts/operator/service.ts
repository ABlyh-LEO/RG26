import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { eventFileSchema, publicSnapshotSchema, type EventFile } from '../../src/domain/schema';
import { validateEvent } from '../../src/domain/validation';
import { canExportOfficial } from '../../src/domain/corrections';
import type {
  DraftEnvelope, FrozenPreview, OperatorState, PreflightResult, PublishJob,
  PublishRequest, SaveDraftRequest, SourceState,
} from '../../src/operator/contracts';
import { VERIFY_GRACE_MS } from '../../src/operator/contracts';
import { pushedAtMs } from '../../src/operator/contracts';
import { OperatorError, safeMessage } from './errors';
import { DATA_FILES, fetchRemote, git, githubCoordinates, inspectGit, networkEnvironment } from './git';
import { atomicJson, atomicText, optionalText, revision, summarizeChanges } from './storage';
import { readRemoteJson, type JsonResponse } from './network';

interface StoredDraft { schemaVersion: 1; draft: DraftEnvelope; baseEvent: EventFile; preview: FrozenPreview | null }
interface Transaction { head: string; source: string; snapshot: string | null; index: string; targetRevision: string }
export interface OperatorServiceOptions {
  pagesUrl?: string;
  readJson?: (url: string) => Promise<JsonResponse>;
  /** Deterministic fault injection for transaction tests; production uses the real Git implementation. */
  beforeCommit?: () => Promise<void>;
}

export class OperatorService {
  readonly storage: string;
  private stored!: StoredDraft;
  private jobs: PublishJob[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private running = new Map<string, Promise<void>>();
  private lastRemoteCheck = new Map<string, number>();
  private apiPausedUntil = 0;
  private lastApiCheck = 0;
  private ownsLock = false;

  constructor(readonly root: string, private readonly options: OperatorServiceOptions = {}) {
    this.storage = join(root, '.local', 'operator');
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private now(): string { return new Date().toISOString(); }
  private async persistDraft(): Promise<void> { await atomicJson(join(this.storage, 'draft.json'), this.stored); }
  private async persistJob(job: PublishJob): Promise<void> {
    job.updatedAt = this.now();
    await atomicJson(join(this.storage, 'jobs', `${job.id}.json`), job);
  }
  private async log(job: PublishJob, message: string): Promise<void> {
    job.logs.push({ id: randomUUID(), at: this.now(), message });
    await this.persistJob(job);
  }
  private async stage(job: PublishJob, status: PublishJob['phase'], message: string): Promise<void> {
    job.status = status; job.phase = status; job.error = null;
    await this.log(job, message);
  }
  async source(): Promise<SourceState> {
    const text = await optionalText(join(this.root, DATA_FILES[0]));
    if (text === null) throw new OperatorError('SOURCE_MISSING', '找不到 data/event.json');
    const event = eventFileSchema.parse(JSON.parse(text));
    const commit = await git(this.root, ['rev-parse', 'HEAD']).catch(() => null);
    return { revision: revision(event), event, commit };
  }
  private fresh(source: SourceState, version: number): StoredDraft {
    return { schemaVersion: 1, baseEvent: source.event, preview: null,
      draft: { version, baseRevision: source.revision, baseCommit: source.commit, event: source.event,
        formInputs: {}, logs: [], dirty: false, updatedAt: this.now(), migrationRequiresReview: false } };
  }
  async initialize(): Promise<void> {
    await mkdir(join(this.storage, 'jobs'), { recursive: true });
    const lockPath = join(this.storage, 'service.lock');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(String(process.pid)); await handle.close(); this.ownsLock = true; break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = Number(await optionalText(lockPath));
        let alive = Number.isInteger(pid) && pid > 0;
        if (alive) { try { process.kill(pid, 0); } catch (probe) { alive = (probe as NodeJS.ErrnoException).code !== 'ESRCH'; } }
        if (alive || attempt > 0) throw new OperatorError('SERVICE_ACTIVE', '另一个维护服务正在使用此仓库。请使用已打开的工作台，或关闭它后再运行命令。', 409);
        await unlink(lockPath);
      }
    }
    const source = await this.source();
    const old = await optionalText(join(this.storage, 'draft.json'));
    if (old) {
      const value = JSON.parse(old) as StoredDraft;
      if (value.schemaVersion !== 1 || !Number.isInteger(value.draft.version)) throw new OperatorError('DRAFT_SCHEMA', '本机草稿版本无法读取；原文件已保留，请先导出备份。');
      value.draft.event = eventFileSchema.parse(value.draft.event);
      value.baseEvent = eventFileSchema.parse(value.baseEvent);
      this.stored = value;
    } else { this.stored = this.fresh(source, 1); await this.persistDraft(); }
    for (const file of await readdir(join(this.storage, 'jobs'))) {
      if (!/^[a-f0-9-]+\.json$/.test(file)) continue;
      const text = await optionalText(join(this.storage, 'jobs', file));
      if (text) this.jobs.push(JSON.parse(text) as PublishJob);
    }
    this.jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const job of this.jobs) {
      if (['checking', 'saving', 'committing', 'committed', 'pushing'].includes(job.status)) await this.recover(job);
    }
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
    if (this.ownsLock) { await unlink(join(this.storage, 'service.lock')).catch(() => undefined); this.ownsLock = false; }
  }
  private async recover(job: PublishJob): Promise<void> {
    const path = join(this.storage, 'transactions', `${job.id}.json`);
    const text = await optionalText(path);
    const transaction = text ? JSON.parse(text) as Transaction : null;
    const head = await git(this.root, ['rev-parse', 'HEAD']);
    if (!job.commit && transaction && head !== transaction.head) job.commit = await this.findTransactionCommit(transaction, job);
    if (job.commit) {
      job.status = 'failed'; job.phase = 'pushing'; job.retryable = true;
      job.error = '工具上次在提交后退出。改动已保留；重试将推送同一提交。';
      await this.refreshBaseAfterCommit(job);
    } else {
      if (transaction && head === transaction.head) await this.restore(transaction);
      job.status = 'failed'; job.retryable = false;
      job.error = head === transaction?.head || !transaction
        ? '工具上次在提交前退出，已恢复原文件；草稿保留，请重新预览发布。'
        : 'Git 在工具退出期间发生变化。原备份已保留，请检查工作区后重新预览。';
    }
    await this.log(job, job.error);
  }
  private async findTransactionCommit(transaction: Transaction, job: PublishJob): Promise<string | null> {
    try {
      const [head, parent, message, paths, text] = await Promise.all([
        git(this.root, ['rev-parse', 'HEAD']), git(this.root, ['rev-parse', 'HEAD^']),
        git(this.root, ['show', '-s', '--format=%B', 'HEAD']),
        git(this.root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']),
        git(this.root, ['show', `HEAD:${DATA_FILES[0]}`]),
      ]);
      if (parent !== transaction.head || !message.split(/\r?\n/).includes(`RG26-Operator-Job: ${job.id}`)) return null;
      if (paths.split(/\r?\n/).some((path) => !DATA_FILES.includes(path as typeof DATA_FILES[number]))) return null;
      return revision(eventFileSchema.parse(JSON.parse(text))) === job.targetRevision ? head : null;
    } catch { return null; }
  }
  private expectVersion(expected: number): void {
    if (expected !== this.stored.draft.version) throw new OperatorError('VERSION_CONFLICT', '草稿已被另一操作更新，请重新载入后重试。', 409, { currentVersion: this.stored.draft.version });
  }
  /**
   * 任务是否"已推送但等核验超时"。
   *
   * 这类任务**不再阻塞下一批发布**：部署失败时公开站点永远不会返回该版本，
   * GitHub API 限流时又查不到结论（日志里的"部署状态暂不可查询"），
   * 两者叠加会让任务永久停在 deploying，把发布锁死——录入的成绩就再也发不出去。
   * 推送成功后 Git 工作区是干净的，因此在其之上继续提交/推送是安全的。
   */
  private isStaleVerification(job: PublishJob, now = Date.now()): boolean {
    if (job.status !== 'deploying') return false;
    const since = pushedAtMs(job);
    return since !== null && now - since >= VERIFY_GRACE_MS;
  }
  /** 把等核验超时的任务落成终态 `unverified`（已推送、未核验），不再占用"进行中"。 */
  private async retireStaleVerifications(): Promise<void> {
    for (const job of this.jobs.filter((candidate) => this.isStaleVerification(candidate))) {
      job.status = 'unverified';
      job.retryable = false;
      job.error = `已推送但未在 ${Math.round(VERIFY_GRACE_MS / 60_000)} 分钟内确认观众可见（常见原因是部署失败，或部署状态无法查询）。这不影响继续发布下一批；如需确认这一次，可点"检查上线状态"，或到 GitHub Actions 查看该提交的运行日志。`;
      await this.log(job, '等核验超时：本任务不再阻塞下一批发布。');
    }
  }
  private assertIdle(): void {
    const active = this.jobs.find((job) => !['live', 'failed', 'unverified'].includes(job.status) && !this.isStaleVerification(job));
    if (active) throw new OperatorError('JOB_ACTIVE', '已有发布任务正在进行，请等待它完成或处理失败。', 409);
    if (this.jobs.some((job) => job.status === 'committed' || (job.status === 'failed' && job.commit && job.retryable))) throw new OperatorError('PUSH_PENDING', '上次发布已提交但尚未推送，请先重试该任务。', 409);
  }
  async state(readOnly = false): Promise<OperatorState> {
    return { source: await this.source(), draft: structuredClone(this.stored.draft), preview: structuredClone(this.stored.preview),
      jobs: structuredClone(this.jobs), git: await inspectGit(this.root, this.options.pagesUrl), readOnly };
  }
  async save(request: SaveDraftRequest): Promise<DraftEnvelope> {
    return this.serial(async () => {
      this.expectVersion(request.expectedVersion);
      if (this.jobs.some((job) => this.running.has(job.id) && ['checking', 'saving', 'committing', 'committed'].includes(job.phase))) {
        throw new OperatorError('JOB_BUSY', '正在创建发布提交，请稍后保存下一批草稿。', 409);
      }
      const event = eventFileSchema.parse(request.event);
      const draft = this.stored.draft;
      this.stored.preview = null;
      this.stored.draft = { ...draft, event, version: draft.version + 1, updatedAt: this.now(),
        formInputs: request.formInputs ?? draft.formInputs,
        dirty: revision(event) !== draft.baseRevision,
        migrationRequiresReview: request.migrationRequiresReview ?? draft.migrationRequiresReview,
        logs: [...draft.logs, { id: randomUUID(), at: this.now(), message: request.message?.trim() || '保存草稿' }].slice(-200) };
      await this.persistDraft();
      return structuredClone(this.stored.draft);
    });
  }
  async reset(expectedVersion: number): Promise<DraftEnvelope> {
    return this.serial(async () => {
      this.expectVersion(expectedVersion); this.assertIdle();
      this.stored = this.fresh(await this.source(), expectedVersion + 1);
      await this.persistDraft();
      return structuredClone(this.stored.draft);
    });
  }
  async sync(expectedVersion: number): Promise<OperatorState> {
    return this.serial(async () => {
      this.expectVersion(expectedVersion); this.assertIdle();
      if (this.stored.draft.dirty || Object.keys(this.stored.draft.formInputs).length) throw new OperatorError('DRAFT_DIRTY', '请先发布或明确放弃当前草稿，再同步远端。', 409);
      const state = await inspectGit(this.root, this.options.pagesUrl);
      if (state.blockers.length || state.dirtyPaths.length) throw new OperatorError('GIT_DIRTY', '同步需要干净的 main 工作区。', 409, state.blockers);
      await fetchRemote(this.root);
      await git(this.root, ['merge', '--ff-only', 'refs/remotes/origin/main']);
      this.stored = this.fresh(await this.source(), expectedVersion + 1);
      await this.persistDraft();
      return this.state();
    });
  }
  async validate(expectedVersion: number): Promise<PreflightResult> {
    this.expectVersion(expectedVersion);
    const source = await this.source();
    return checkEvent(this.root, source, this.stored.draft.event, this.stored.draft.baseRevision,
      this.stored.draft.migrationRequiresReview, this.options.pagesUrl);
  }
  async preview(expectedVersion: number): Promise<FrozenPreview> {
    return this.serial(async () => {
      this.expectVersion(expectedVersion);
      const checked = await this.validate(expectedVersion);
      if (!checked.ok) throw new OperatorError('VALIDATION', '草稿尚不能发布，请先处理列出的问题。', 422, checked);
      const frozen: FrozenPreview = {
        id: randomUUID(), draftVersion: expectedVersion, baseRevision: this.stored.draft.baseRevision,
        targetRevision: revision(this.stored.draft.event), expectedHead: checked.git.head ?? '', createdAt: this.now(),
        snapshot: publicSnapshotSchema.parse({ schemaVersion: 1, revision: revision(this.stored.draft.event),
          builtAt: this.now(), sourceCommit: checked.git.head, data: this.stored.draft.event }),
        changes: checked.changes, warnings: checked.warnings,
      };
      this.stored.preview = frozen;
      await this.persistDraft();
      return structuredClone(frozen);
    });
  }
  async publish(request: PublishRequest, push = true): Promise<PublishJob> {
    return this.serial(async () => {
      // 先把"等核验超时"的历史任务落成终态，避免它继续挡住新发布。
      await this.retireStaleVerifications();
      this.expectVersion(request.expectedVersion); this.assertIdle();
      const preview = this.stored.preview;
      if (!preview || preview.id !== request.previewId || preview.draftVersion !== request.expectedVersion) throw new OperatorError('PREVIEW_STALE', '预览已失效，请重新检查变更再发布。', 409);
      if (preview.targetRevision === preview.baseRevision) throw new OperatorError('NO_CHANGES', '没有需要发布的赛事变更。', 409);
      const job: PublishJob = { id: randomUUID(), status: 'checking', phase: 'checking', createdAt: this.now(), updatedAt: this.now(),
        previewId: preview.id, draftVersion: preview.draftVersion, targetRevision: preview.targetRevision, commit: null,
        message: request.message?.trim() || `更新赛事：${preview.changes.length} 项变更`, logs: [], error: null, retryable: false,
        pagesUrl: null, actionsUrl: null, workflowConclusion: null };
      this.jobs.unshift(job);
      await this.persistJob(job);
      // Defer until the HTTP response can return a durable job ID.
      const work = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => this.execute(job, structuredClone(preview), push));
      this.running.set(job.id, work);
      void work.then(() => this.running.delete(job.id), () => this.running.delete(job.id));
      return structuredClone(job);
    });
  }
  async waitForJob(id: string): Promise<PublishJob> {
    await this.running.get(id);
    return structuredClone(this.job(id));
  }
  private job(id: string): PublishJob {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job) throw new OperatorError('JOB_NOT_FOUND', '没有找到发布任务。', 404);
    return job;
  }
  private async restore(transaction: Transaction): Promise<void> {
    await atomicText(join(this.root, DATA_FILES[0]), transaction.source);
    if (transaction.snapshot === null) await unlink(join(this.root, DATA_FILES[1])).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    else await atomicText(join(this.root, DATA_FILES[1]), transaction.snapshot);
    // Restore only our two index entries; unrelated staging performed by another tool is untouched.
    await git(this.root, ['update-index', '--force-remove', ...DATA_FILES]);
    if (transaction.index) await git(this.root, ['update-index', '--index-info'], { input: `${transaction.index}\n` });
  }
  private async refreshBaseAfterCommit(job: PublishJob): Promise<void> {
    if (this.stored.draft.version !== job.draftVersion) return;
    const source = await this.source();
    if (source.revision !== job.targetRevision) return;
    const { formInputs, logs } = this.stored.draft;
    this.stored = this.fresh(source, this.stored.draft.version + 1);
    // Unconfirmed fields for other matches belong to the next batch, never to the public snapshot.
    this.stored.draft.formInputs = formInputs;
    this.stored.draft.logs = logs;
    await this.persistDraft();
  }
  private async execute(job: PublishJob, preview: FrozenPreview, push: boolean): Promise<void> {
    let transaction: Transaction | null = null;
    try {
      await this.log(job, '检查源版本、main 分支和暂存区。');
      let state = await inspectGit(this.root, this.options.pagesUrl);
      if (state.blockers.length) throw new OperatorError('GIT_BLOCKED', state.blockers.join('\n'), 409);
      if (state.head !== preview.expectedHead) throw new OperatorError('HEAD_CHANGED', 'Git 提交已变化，请重新预览。', 409);
      if ((await this.source()).revision !== preview.baseRevision) throw new OperatorError('SOURCE_CHANGED', '正式源数据已变化，草稿已保留，请处理冲突。', 409);
      const checked = await checkEvent(this.root, await this.source(), preview.snapshot.data, preview.baseRevision, false, this.options.pagesUrl);
      if (!checked.ok) throw new OperatorError('VALIDATION', checked.errors.join('\n'), 422);
      await fetchRemote(this.root);
      state = await inspectGit(this.root, this.options.pagesUrl);
      if (state.behind > 0) throw new OperatorError('REMOTE_CHANGED', '远端已有新提交，请先同步并复核草稿；本次没有写入源数据。', 409);
      if (state.ahead > 0) throw new OperatorError('LOCAL_COMMITS_PENDING', 'main 已有尚未推送的其他提交，请先单独处理这些提交；工作台不会将它们夹带发布。', 409);
      // A second check closes the normal editing gap during network fetch.
      if (state.blockers.length || state.head !== preview.expectedHead || (await this.source()).revision !== preview.baseRevision) throw new OperatorError('SOURCE_CHANGED', '检查期间工作区发生变化，请重新预览。', 409);
      job.pagesUrl = state.pagesUrl;
      const coordinates = state.remote ? githubCoordinates(state.remote) : null;
      if (coordinates) job.actionsUrl = `https://github.com/${coordinates.owner}/${coordinates.repo}/actions`;
      transaction = { head: state.head!, source: (await optionalText(join(this.root, DATA_FILES[0])))!,
        snapshot: await optionalText(join(this.root, DATA_FILES[1])), index: await git(this.root, ['ls-files', '--stage', '--', ...DATA_FILES]), targetRevision: job.targetRevision };
      await atomicJson(join(this.storage, 'transactions', `${job.id}.json`), transaction);
      await this.stage(job, 'saving', '保存正式数据与公开快照。');
      await atomicJson(join(this.root, DATA_FILES[0]), preview.snapshot.data);
      await atomicJson(join(this.root, DATA_FILES[1]), preview.snapshot);
      await this.stage(job, 'committing', '只提交本次赛事数据文件。');
      await this.options.beforeCommit?.();
      const current = await inspectGit(this.root, this.options.pagesUrl);
      if (current.blockers.length || current.head !== transaction.head) throw new OperatorError('GIT_CHANGED', '提交前工作区发生变化，本次发布停止。', 409);
      await git(this.root, ['add', '--', ...DATA_FILES]);
      await git(this.root, ['commit', '--only', '-m', job.message, '-m', `RG26-Operator-Job: ${job.id}`, '--', ...DATA_FILES]);
      job.commit = await git(this.root, ['rev-parse', 'HEAD']);
      await this.stage(job, 'committed', `已提交 ${job.commit.slice(0, 12)}。`);
      await this.refreshBaseAfterCommit(job);
      if (!push) { job.retryable = true; await this.log(job, '按要求暂不推送；重试此任务可继续发布同一提交。'); return; }
      await this.push(job);
    } catch (error) {
      if (!job.commit && transaction) {
        const head = await git(this.root, ['rev-parse', 'HEAD']).catch(() => '');
        if (head === transaction.head) await this.restore(transaction);
        else job.commit = await this.findTransactionCommit(transaction, job);
      }
      job.status = 'failed'; job.error = safeMessage(error); job.retryable = Boolean(job.commit);
      if (job.commit) { job.phase = 'pushing'; await this.refreshBaseAfterCommit(job); }
      await this.log(job, `${job.commit ? '本地提交已保留，可重试推送同一提交。' : '未创建发布提交；草稿保留。'} ${job.error}`);
    }
  }
  private async push(job: PublishJob): Promise<void> {
    if (!job.commit) throw new OperatorError('NO_COMMIT', '该任务还没有提交。', 409);
    const state = await inspectGit(this.root, this.options.pagesUrl);
    if (state.branch !== 'main' || state.head !== job.commit) throw new OperatorError('HEAD_CHANGED', '当前分支或提交已变化，不能替你推送其他工作。', 409);
    await this.stage(job, 'pushing', '推送已确认的 main 提交。');
    const network = await networkEnvironment(this.root);
    await this.log(job, `网络方式：${network.source}。`);
    await git(this.root, ['push', 'origin', `${job.commit}:refs/heads/main`], { env: network.env, timeout: 60_000 });
    job.retryable = false;
    job.pushedAt = this.now();
    await this.stage(job, 'deploying', '已推送，等待 Pages 部署；尚未确认观众可见。');
  }
  async retry(id: string): Promise<PublishJob> {
    return this.serial(async () => {
      const job = this.job(id);
      if (this.running.size || this.jobs.some((other) => other.id !== id && !['live', 'failed'].includes(other.status))) throw new OperatorError('JOB_ACTIVE', '已有其他发布任务正在进行。', 409);
      if (!job.commit || !job.retryable) throw new OperatorError('RETRY_NOT_AVAILABLE', '提交前失败请重新预览；部署中请检查上线状态。', 409);
      const work = this.push(job).catch(async (error) => {
        job.status = 'failed'; job.error = safeMessage(error); job.retryable = true;
        await this.log(job, `推送尚未成功，提交已保留。${job.error}`);
      });
      this.running.set(id, work);
      void work.then(() => this.running.delete(id), () => this.running.delete(id));
      return structuredClone(job);
    });
  }
  async checkLive(id: string, force = false): Promise<PublishJob> {
    const job = this.job(id);
    if (!job.commit || job.status === 'live' || job.status === 'committed' || job.phase === 'pushing') return structuredClone(job);
    const time = Date.now();
    if (!force && time - (this.lastRemoteCheck.get(id) ?? 0) < 15_000) return structuredClone(job);
    this.lastRemoteCheck.set(id, time);
    const read = this.options.readJson ?? ((url: string) => readRemoteJson(this.root, url));
    if (job.pagesUrl) {
      try {
        const url = new URL('data/event.json', job.pagesUrl.endsWith('/') ? job.pagesUrl : `${job.pagesUrl}/`);
        url.searchParams.set('verify', `${job.targetRevision}-${time}`);
        const response = await read(url.href);
        const snapshot = publicSnapshotSchema.safeParse(response.data);
        if (response.status === 200 && snapshot.success && snapshot.data.revision === job.targetRevision && snapshot.data.sourceCommit === job.commit) {
          job.retryable = false; job.workflowConclusion = 'success';
          await this.stage(job, 'live', '公开站点已返回本次数据版本和提交；观众已可见。');
          return structuredClone(job);
        }
      } catch { /* Actions is supplementary; keep the public revision check available after API rate limits. */ }
    }
    const state = await inspectGit(this.root, this.options.pagesUrl);
    const coordinates = state.remote ? githubCoordinates(state.remote) : null;
    if (coordinates && time >= this.apiPausedUntil && time - this.lastApiCheck > 60_000) {
      this.lastApiCheck = time;
      try {
        const response = await read(`https://api.github.com/repos/${coordinates.owner}/${coordinates.repo}/actions/runs?head_sha=${job.commit}&per_page=20`);
        if (response.status === 403 || response.status === 429) {
          this.apiPausedUntil = time + 10 * 60_000;
          await this.log(job, '部署状态暂不可查询：GitHub API 已限流或暂不允许访问；仍将继续核对公开站点版本。');
        }
        if (response.status === 200 && response.data && typeof response.data === 'object' && 'workflow_runs' in response.data) {
          const runs = (response.data as { workflow_runs: { head_sha: string; path: string; status: string; conclusion: string | null; html_url: string }[] }).workflow_runs;
          const run = runs.find((candidate) => candidate.head_sha === job.commit && candidate.path === '.github/workflows/deploy.yml');
          if (run) {
            job.actionsUrl = run.html_url; job.workflowConclusion = run.conclusion;
            if (run.status === 'completed' && run.conclusion && run.conclusion !== 'success') {
              job.status = 'failed'; job.phase = 'deploying'; job.retryable = false;
              job.error = 'GitHub 部署检查未通过；请查看运行日志，修复后发布新版本，或在 Actions 重跑本次部署。';
            } else { job.status = 'deploying'; job.phase = 'deploying'; job.error = null; }
          }
        }
      } catch {
        const message = '部署状态暂不可查询：GitHub API 无法连接；仍将继续核对公开站点版本。';
        if (job.logs.at(-1)?.message !== message) await this.log(job, message);
      }
    }
    await this.persistJob(job);
    // 等核验超过期限就落成终态，避免历史任务永远停在"已推送，等待部署"。
    if (this.isStaleVerification(job)) await this.retireStaleVerifications();
    return structuredClone(job);
  }
  async checkPending(): Promise<void> {
    /*
     * `unverified` 也要继续核验：宽限（2 分钟）通常短于一次 Pages 部署，
     * 正常成功的发布也会先落到这个状态。若不继续核验，部署其实成功却永远
     * 显示"未核验"，观众可见的确认就丢了。
     */
    for (const job of this.jobs.filter((candidate) => candidate.status === 'deploying' || candidate.status === 'unverified' || (candidate.status === 'failed' && candidate.phase === 'deploying'))) await this.checkLive(job.id);
    await this.retireStaleVerifications();
  }
}

/** Read-only validation shared by the CLI's dry run and the workbench. */
export async function checkEvent(root: string, source: SourceState, event: EventFile, baseRevision: string,
  migrationRequiresReview = false, pagesUrl?: string): Promise<PreflightResult> {
  const parsed = eventFileSchema.parse(event);
  const validation = validateEvent(parsed);
  const gate = canExportOfficial(parsed);
  const errors = validation.errors.map((error) => `${error.objectId ?? error.objectType}：${error.message}`);
  errors.push(...gate.reasons);
  if (source.revision !== baseRevision) errors.push('基础版本与正式源数据不一致，请保留草稿并处理冲突后重新预览。');
  if (migrationRequiresReview) errors.push('迁移草稿需要先核对后确认，才能发布。');
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: validation.warnings.map((warning) => warning.message),
    changes: summarizeChanges(source.event, parsed), sourceRevision: source.revision, git: await inspectGit(root, pagesUrl) };
}
