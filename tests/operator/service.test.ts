import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request, type Server } from 'node:http';
import { eventFileSchema } from '../../src/domain/schema';
import { buildSeedEvent } from '../../scripts/seed-data';
import { OperatorService, checkEvent, type OperatorServiceOptions } from '../../scripts/operator/service';
import { createOperatorApi } from '../../scripts/operator/http';
import { git, inspectGit } from '../../scripts/operator/git';
import { optionalText, revision } from '../../scripts/operator/storage';
import { runPublish } from '../../scripts/operator/cli';
import type { SessionResponse } from '../../src/operator/contracts';
import { VERIFY_GRACE_MS } from '../../src/operator/contracts';

const roots: string[] = [];
const services: OperatorService[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); })));
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository() {
  const temporary = await mkdtemp(join(tmpdir(), 'rg26 operator 测试 ')); roots.push(temporary);
  const root = join(temporary, 'working'); const remote = join(temporary, 'remote.git');
  await mkdir(root); await mkdir(remote);
  await git(remote, ['init', '--bare', '--initial-branch=main']);
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'Operator Tests']);
  await git(root, ['config', 'user.email', 'operator@example.invalid']);
  const event = eventFileSchema.parse(buildSeedEvent('2026-10-02T12:00:00+08:00'));
  await mkdir(join(root, 'data')); await mkdir(join(root, 'public', 'data'), { recursive: true });
  await writeFile(join(root, 'data/event.json'), JSON.stringify(event));
  await writeFile(join(root, 'public/data/event.json'), JSON.stringify({ schemaVersion: 1, revision: revision(event), builtAt: '2026-10-02T04:00:00Z', sourceCommit: null, data: event }));
  await writeFile(join(root, '.gitignore'), '.local/operator/\n');
  await writeFile(join(root, 'README.md'), 'unrelated source');
  await git(root, ['add', '.']); await git(root, ['commit', '-m', 'initial']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await git(root, ['push', '-u', 'origin', 'main']);
  return { root, remote, event };
}
async function serviceFor(root: string, options?: OperatorServiceOptions) {
  const service = new OperatorService(root, options); services.push(service); await service.initialize(); return service;
}
function updateEvent(event: ReturnType<typeof buildSeedEvent>) {
  const changed = structuredClone(event);
  changed.notices.push({ id: 'test-announcement', title: '测试公告', body: '仅用于临时仓库事务验证', severity: 'info', at: '2026-10-02T05:00:00Z' });
  changed.event.contentUpdatedAt = '2026-10-02T05:00:00Z';
  return changed;
}
async function prepared(service: OperatorService) {
  const state = await service.state();
  const draft = await service.save({ expectedVersion: state.draft.version, event: updateEvent(state.draft.event) });
  const preview = await service.preview(draft.version);
  return { draft, preview };
}

describe('维护草稿与发布事务', { timeout: 20_000 }, () => {
  it('CLI dry-run 只读，保留源、快照、暂存区且不创建本机存储', async () => {
    const { root, event } = await repository();
    const path = join(root, '..', 'handoff.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, baseRevision: revision(event), exportedAt: '2026-10-02T05:00:00Z', event: updateEvent(event) }));
    const before = await Promise.all(['data/event.json', 'public/data/event.json'].map((file) => readFile(join(root, file), 'utf8')));
    const index = await readFile(join(root, '.git/index'));
    const messages: string[] = [];
    expect(await runPublish(root, ['--file', path, '--dry-run'], (message) => messages.push(message))).toBe(0);
    expect(await Promise.all(['data/event.json', 'public/data/event.json'].map((file) => readFile(join(root, file), 'utf8')))).toEqual(before);
    expect(await readFile(join(root, '.git/index'))).toEqual(index);
    expect(await optionalText(join(root, '.local/operator/draft.json'))).toBeNull();
    expect(messages.join()).toContain('只读检查完成');
    expect(await runPublish(root, ['--retry', 'any', '--dry-run'], () => undefined)).toBe(2);
    expect(await optionalText(join(root, '.local/operator/service.lock'))).toBeNull();
  });

  it('直接读正式源；草稿、输入及日志恢复；旧版本不能覆盖', async () => {
    const { root, event } = await repository();
    await writeFile(join(root, 'public/data/event.json'), '{"stale":true}');
    const service = await serviceFor(root);
    expect((await service.state()).source.event).toEqual(event);
    const draft = await service.save({ expectedVersion: 1, event: updateEvent(event), formInputs: { 'match-a': { score: '16' } }, message: '确认公告' });
    await expect(service.save({ expectedVersion: 1, event })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await service.close();
    const restarted = await serviceFor(root);
    expect((await restarted.state()).draft).toEqual(draft);
  });

  it('同仓库第二服务不能绕过单会话写入', async () => {
    const { root } = await repository(); await serviceFor(root);
    const duplicate = new OperatorService(root);
    await expect(duplicate.initialize()).rejects.toMatchObject({ code: 'SERVICE_ACTIVE' });
  });

  it('预览和CLI共享只读检查不修改正式文件；代码有修改仍可预览', async () => {
    const { root, event } = await repository();
    const service = await serviceFor(root);
    const before = await readFile(join(root, 'data/event.json'), 'utf8');
    const publicBefore = await readFile(join(root, 'public/data/event.json'), 'utf8');
    await writeFile(join(root, 'README.md'), 'ongoing user work');
    const check = await checkEvent(root, await service.source(), updateEvent(event), revision(event));
    expect(check.ok).toBe(true); expect(check.git.blockers.length).toBeGreaterThan(0);
    const { draft, preview } = await prepared(service);
    expect(preview.snapshot.data.notices.at(-1)?.title).toBe('测试公告');
    expect(await readFile(join(root, 'data/event.json'), 'utf8')).toBe(before);
    expect(await readFile(join(root, 'public/data/event.json'), 'utf8')).toBe(publicBefore);
    await service.save({ expectedVersion: draft.version, event: draft.event, message: '预览后再次保存' });
    await expect(service.publish({ expectedVersion: draft.version + 1, previewId: preview.id })).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
  });

  it('源版本变化与迁移待复核都阻止冻结发布', async () => {
    const { root, event } = await repository(); const service = await serviceFor(root);
    const draft = await service.save({ expectedVersion: 1, event: updateEvent(event), migrationRequiresReview: true });
    expect((await service.validate(draft.version)).errors.join()).toContain('迁移草稿');
    await service.save({ expectedVersion: draft.version, event: draft.event, migrationRequiresReview: false });
    const external = structuredClone(event); external.event.scheduleNotice += ' externally changed';
    await writeFile(join(root, 'data/event.json'), JSON.stringify(external));
    await expect(service.preview(draft.version + 1)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('无关暂存文件阻止发布，且不会被提交或清空', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const { draft, preview } = await prepared(service);
    await writeFile(join(root, 'README.md'), 'staged user work'); await git(root, ['add', 'README.md']);
    const head = await git(root, ['rev-parse', 'HEAD']);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id });
    const failed = await service.waitForJob(job.id);
    expect(failed.status).toBe('failed'); expect(failed.commit).toBeNull();
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(await git(root, ['show', ':README.md'])).toBe('staged user work');
  });

  it('Git status 无法读取暂存区时拒绝发布，不误认成干净工作区', async () => {
    const { root } = await repository();
    await writeFile(join(root, '.git/index'), 'simulated corrupt index');
    expect((await inspectGit(root)).blockers.join()).toContain('无法检查 Git 工作区或暂存区');
  });

  it('main 已有其他未推送提交时不夹带发布', async () => {
    const { root, remote } = await repository();
    await writeFile(join(root, 'README.md'), 'unpublished code'); await git(root, ['add', 'README.md']); await git(root, ['commit', '-m', 'unreviewed code']);
    const service = await serviceFor(root); const { draft, preview } = await prepared(service);
    const head = await git(root, ['rev-parse', 'HEAD']); const remoteHead = await git(remote, ['rev-parse', 'main']);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id });
    const failed = await service.waitForJob(job.id);
    expect(failed.status).toBe('failed'); expect(failed.error).toContain('尚未推送的其他提交');
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(await git(remote, ['rev-parse', 'main'])).toBe(remoteHead);
  });

  it('提交前异常精确恢复原源文件、快照和数据暂存状态', async () => {
    const { root, event } = await repository();
    const staged = structuredClone(event); staged.event.scheduleNotice += ' preserved staged edit';
    await writeFile(join(root, 'data/event.json'), JSON.stringify(staged)); await git(root, ['add', 'data/event.json']);
    const indexBefore = await git(root, ['ls-files', '--stage']);
    const sourceBefore = await readFile(join(root, 'data/event.json'), 'utf8');
    const publicBefore = await readFile(join(root, 'public/data/event.json'), 'utf8');
    const service = await serviceFor(root, { beforeCommit: async () => { throw new Error('simulated disk/commit failure'); } });
    const { draft, preview } = await prepared(service);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id });
    expect((await service.waitForJob(job.id)).status).toBe('failed');
    expect(await readFile(join(root, 'data/event.json'), 'utf8')).toBe(sourceBefore);
    expect(await readFile(join(root, 'public/data/event.json'), 'utf8')).toBe(publicBefore);
    expect(await git(root, ['ls-files', '--stage'])).toBe(indexBefore);
    expect((await service.state()).draft.dirty).toBe(true);
  });

  it('真实提交与push失败后，重启只重推同一commit，并核验公开revision+commit', async () => {
    const { root, remote } = await repository();
    await git(root, ['remote', 'set-url', '--push', 'origin', join(root, 'not-a-remote')]);
    const service = await serviceFor(root, { pagesUrl: 'https://example.invalid/RG26/' });
    const { draft, preview } = await prepared(service);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id, message: 'scores "quoted" $(not-shell)' });
    const failed = await service.waitForJob(job.id);
    expect(failed.status).toBe('failed'); expect(failed.commit).toMatch(/^[a-f0-9]{40}$/); expect(failed.retryable).toBe(true);
    const commitCount = await git(root, ['rev-list', '--count', 'HEAD']);
    await service.close(); await git(root, ['remote', 'set-url', '--push', 'origin', remote]);
    let visibleCommit = 'wrong-commit'; let apiRequests = 0;
    const restarted = await serviceFor(root, { readJson: async (url) => {
      if (url.startsWith('https://api.github.com/')) { apiRequests += 1; return { status: 429, data: null }; }
      return { status: 200, data: { ...preview.snapshot, sourceCommit: visibleCommit } };
    } });
    await restarted.retry(job.id);
    const pushed = await restarted.waitForJob(job.id);
    expect(pushed.status).toBe('deploying');
    expect(await git(root, ['rev-list', '--count', 'HEAD'])).toBe(commitCount);
    expect(await git(remote, ['rev-parse', 'main'])).toBe(failed.commit);
    await git(root, ['remote', 'set-url', 'origin', 'https://github.com/example/event.git']);
    const unavailable = await restarted.checkLive(job.id, true);
    expect(unavailable.status).toBe('deploying');
    expect(unavailable.logs.at(-1)?.message).toContain('部署状态暂不可查询');
    expect(apiRequests).toBe(1);
    visibleCommit = failed.commit!;
    expect((await restarted.checkLive(job.id, true)).status).toBe('live');
    expect(apiRequests).toBe(1);
  });

  it('提交完成但任务记录未更新时，重启识别该提交并继续而不重新提交', async () => {
    const { root, remote } = await repository(); const service = await serviceFor(root);
    const state = await service.state();
    const draft = await service.save({ expectedVersion: state.draft.version, event: updateEvent(state.draft.event), formInputs: { 'next-match': { score: '12.' } } });
    const preview = await service.preview(draft.version);
    preview.snapshot.data.notices.at(-1)!.title = '调用方误改的预览';
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id }, false);
    await expect(service.publish({ expectedVersion: draft.version, previewId: preview.id })).rejects.toMatchObject({ code: 'JOB_ACTIVE' });
    const committed = await service.waitForJob(job.id);
    expect(committed.status).toBe('committed');
    expect((await service.state()).draft.formInputs).toEqual({ 'next-match': { score: '12.' } });
    expect((await service.source()).event.notices.at(-1)?.title).toBe('测试公告');
    await service.close();
    // Reproduce process exit after git commit, before persisting its SHA.
    await writeFile(join(service.storage, 'jobs', `${job.id}.json`), JSON.stringify({ ...committed, status: 'committing', phase: 'committing', commit: null, retryable: false }));
    const restarted = await serviceFor(root);
    const recovered = (await restarted.state()).jobs[0]!;
    expect(recovered.commit).toBe(committed.commit); expect(recovered.retryable).toBe(true);
    await restarted.retry(recovered.id); await restarted.waitForJob(recovered.id);
    expect(await git(root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await git(remote, ['rev-parse', 'main'])).toBe(committed.commit);
  });

  it('远端有新版本时保留草稿并拒绝覆盖；干净状态只能快进同步', async () => {
    const { root, remote } = await repository(); const service = await serviceFor(root);
    const { draft, preview } = await prepared(service);
    const original = await readFile(join(root, 'data/event.json'), 'utf8');
    const other = join(root, '..', 'other-maintainer');
    await git(root, ['clone', remote, other]);
    await git(other, ['config', 'user.name', 'Second Maintainer']); await git(other, ['config', 'user.email', 'second@example.invalid']);
    await writeFile(join(other, 'README.md'), 'remote update'); await git(other, ['add', 'README.md']); await git(other, ['commit', '-m', 'remote changed']); await git(other, ['push', 'origin', 'main']);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id });
    const failed = await service.waitForJob(job.id);
    expect(failed.status).toBe('failed'); expect(failed.commit).toBeNull(); expect(failed.error).toContain('远端已有新提交');
    expect(await readFile(join(root, 'data/event.json'), 'utf8')).toBe(original);
    await expect(service.sync(draft.version)).rejects.toMatchObject({ code: 'DRAFT_DIRTY' });
    const reset = await service.reset(draft.version);
    const synced = await service.sync(reset.version);
    expect(synced.git.head).toBe(await git(remote, ['rev-parse', 'main']));
  });

  it('未提交的任务中断后恢复备份；草稿仍可继续编辑', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const { draft, preview } = await prepared(service);
    const before = await readFile(join(root, 'data/event.json'), 'utf8');
    const publicBefore = await readFile(join(root, 'public/data/event.json'), 'utf8');
    const id = '12345678-1234-1234-1234-123456789abc';
    await mkdir(join(service.storage, 'transactions'), { recursive: true });
    await writeFile(join(service.storage, 'transactions', `${id}.json`), JSON.stringify({ head: preview.expectedHead, source: before,
      snapshot: publicBefore, index: await git(root, ['ls-files', '--stage', '--', 'data/event.json', 'public/data/event.json']), targetRevision: preview.targetRevision }));
    await writeFile(join(root, 'data/event.json'), JSON.stringify(preview.snapshot.data));
    await writeFile(join(service.storage, 'jobs', `${id}.json`), JSON.stringify({ id, status: 'saving', phase: 'saving', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      previewId: preview.id, draftVersion: draft.version, targetRevision: preview.targetRevision, commit: null, message: 'interrupted', logs: [], error: null,
      retryable: false, pagesUrl: null, actionsUrl: null, workflowConclusion: null }));
    await service.close(); const restarted = await serviceFor(root);
    expect(await readFile(join(root, 'data/event.json'), 'utf8')).toBe(before);
    expect((await restarted.state()).jobs[0]?.status).toBe('failed');
    expect((await restarted.state()).draft.dirty).toBe(true);
  });

  it('同步仅允许干净main且只做fast-forward', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const state = await service.sync(1);
    expect(state.draft.version).toBe(2); expect((await inspectGit(root)).dirtyPaths).toEqual([]);
    await git(root, ['switch', '-c', 'feature']);
    await expect(service.sync(2)).rejects.toMatchObject({ code: 'GIT_DIRTY' });
  });
});

describe('等核验的发布任务不得锁死后续发布', { timeout: 20_000 }, () => {
  /** 发布并推送成功，任务停在 deploying（等观众可见）。 */
  async function pushedJob(root: string, service: OperatorService) {
    const { draft, preview } = await prepared(service);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id });
    const pushed = await service.waitForJob(job.id);
    expect(pushed.status).toBe('deploying');
    expect(pushed.commit).toBeTruthy();
    return { job: pushed, draft, preview };
  }

  it('等核验期间可以继续录入草稿，不被发布状态阻塞', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    await pushedJob(root, service);
    // 核心诉求：发布状态（哪怕是"等部署"）不能挡住继续录入成绩。
    const state = await service.state();
    const saved = await service.save({
      expectedVersion: state.draft.version,
      event: updateEvent(state.draft.event),
      formInputs: { 'result:swiss:swiss-r1-00-1:1': { homeScore: '16' } },
    });
    expect(saved.version).toBe(state.draft.version + 1);
    expect(saved.formInputs).toEqual({ 'result:swiss:swiss-r1-00-1:1': { homeScore: '16' } });
  });

  it('刚推送、仍在等核验的任务依然阻塞下一批发布（避免两个部署抢跑）', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const { preview } = await pushedJob(root, service);
    // 发布完成后草稿版本会前进，用当前版本调用才会走到"任务进行中"的判定。
    const current = await service.state();
    await expect(service.publish({ expectedVersion: current.draft.version, previewId: preview.id }))
      .rejects.toMatchObject({ code: 'JOB_ACTIVE' });
  });

  it('等核验超时的任务落成"已推送·未核验"，并放行下一批发布', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const { job } = await pushedJob(root, service);

    /*
     * 真实场景：部署失败 → 公开站点永远不会返回该版本；GitHub API 又限流
     * （日志里的"部署状态暂不可查询"）→ 任务永远停在 deploying。
     * 这里把推送时间改到超时之前来复现，并重启服务（重启不会恢复 deploying，
     * 这正是它此前会永久锁死的原因）。
     */
    const path = join(service.storage, 'jobs', `${job.id}.json`);
    await writeFile(path, JSON.stringify({
      ...job, pushedAt: new Date(Date.now() - VERIFY_GRACE_MS - 60_000).toISOString(),
    }));
    await service.close();
    const restarted = await serviceFor(root);

    await restarted.checkPending();
    const retired = (await restarted.state()).jobs.find((candidate) => candidate.id === job.id)!;
    expect(retired.status).toBe('unverified');
    expect(retired.retryable).toBe(false);
    expect(retired.error).toContain('未在');
    expect(retired.logs.at(-1)?.message).toContain('不再阻塞下一批发布');

    // 超时任务不再挡路：可以继续录入并发布下一批。
    const next = await prepared(restarted);
    const second = await restarted.publish({ expectedVersion: next.draft.version, previewId: next.preview.id });
    expect((await restarted.waitForJob(second.id)).status).toBe('deploying');
  });

  it('旧任务没有 pushedAt 时按"已推送"日志时间判断超时，不被轮询刷新的 updatedAt 掩盖', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const { job } = await pushedJob(root, service);

    /*
     * 这正是线上卡住的形态：任务产生于引入 pushedAt 之前，而 updatedAt 每次
     * "检查上线状态"都会被刷新。若用 updatedAt 判断，它永远不会超时。
     */
    const old = new Date(Date.now() - VERIFY_GRACE_MS - 60_000).toISOString();
    await writeFile(join(service.storage, 'jobs', `${job.id}.json`), JSON.stringify({
      ...job,
      pushedAt: null,
      updatedAt: new Date().toISOString(),
      logs: job.logs.map((log) => (log.message.includes('已推送，等待 Pages 部署') ? { ...log, at: old } : log)),
    }));
    await service.close();
    const restarted = await serviceFor(root);
    await restarted.checkPending();
    const retired = (await restarted.state()).jobs.find((candidate) => candidate.id === job.id)!;
    expect(retired.status).toBe('unverified');
  });

  it('"未核验"的任务仍在后台核验：公开站点一匹配就自动变成"观众已可见"', async () => {
    const { root, remote } = await repository();
    let visibleCommit = 'wrong-commit';
    // 第一次发布只需要走到"已推送"；核验由后面的 checkPending 触发。
    const service = await serviceFor(root, { pagesUrl: 'https://example.invalid/RG26/' });
    const { draft, preview } = await prepared(service);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id });
    const pushed = await service.waitForJob(job.id);
    expect(pushed.status).toBe('deploying');

    // 2 分钟宽限通常短于一次 Pages 部署：先落成"未核验"，但不阻塞后续发布。
    await writeFile(join(service.storage, 'jobs', `${job.id}.json`), JSON.stringify({
      ...pushed, pushedAt: new Date(Date.now() - VERIFY_GRACE_MS - 1_000).toISOString(),
    }));
    await service.close();
    const restarted = await serviceFor(root, {
      readJson: async (url) => (url.startsWith('https://api.github.com/')
        ? { status: 429, data: null }
        : { status: 200, data: { ...preview.snapshot, sourceCommit: visibleCommit } }),
    });
    await restarted.checkPending();
    expect((await restarted.state()).jobs.find((candidate) => candidate.id === job.id)!.status).toBe('unverified');

    // 部署随后完成：后台核验把它翻成"观众已可见"（生产环境每 15 秒轮询一次，
    // 与 checkLive 的节流间隔一致；测试里直接强制核验以免等待）。
    visibleCommit = pushed.commit!;
    expect((await restarted.checkLive(job.id, true)).status).toBe('live');
    expect(await git(remote, ['rev-parse', 'main'])).toBe(pushed.commit);
  });

  it('已提交但未推送的任务仍然必须优先处理（不允许夹带发布）', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const { draft, preview } = await prepared(service);
    const job = await service.publish({ expectedVersion: draft.version, previewId: preview.id }, false);
    const committed = await service.waitForJob(job.id);
    expect(committed.status).toBe('committed');
    const current = await service.state();
    await expect(service.publish({ expectedVersion: current.draft.version, previewId: preview.id }))
      .rejects.toMatchObject({ code: 'JOB_ACTIVE' });
  });
});

describe('本机会话边界', () => {
  it('Host/Origin/token防护、只读第二页面、接管后旧页面不可写', async () => {
    const { root } = await repository(); const service = await serviceFor(root);
    const server = createServer((req, res) => { void api(req, res); }); servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
    const origin = `http://127.0.0.1:${address.port}`; const api = createOperatorApi(service, origin);
    const post = (path: string, input: unknown, token = '', requestOrigin = origin) => fetch(`${origin}/api/operator${path}`,
      { method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin, 'x-operator-token': token }, body: JSON.stringify(input) });
    expect((await post('/session', { clientId: 'browser-one' }, '', 'https://untrusted.invalid')).status).toBe(403);
    expect((await fetch(`${origin}/api/operator/state`)).status).toBe(401);
    const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${origin}/api/operator/state`, { headers: { host: 'untrusted.invalid' } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(invalidHostStatus).toBe(403);
    const first = await (await post('/session', { clientId: 'browser-one' })).json() as SessionResponse;
    const second = await (await post('/session', { clientId: 'browser-two' })).json() as SessionResponse;
    expect(first.readOnly).toBe(false); expect(second.readOnly).toBe(true);
    expect((await post('/preview', { expectedVersion: 1 }, second.token)).status).toBe(403);
    const takeover = await (await post('/session', { clientId: 'browser-two', takeover: true })).json() as SessionResponse;
    expect(takeover.readOnly).toBe(false);
    expect((await post('/preview', { expectedVersion: 1 }, first.token)).status).toBe(403);
    const oldState = await (await fetch(`${origin}/api/operator/state`, { headers: { 'x-operator-token': first.token } })).json() as { readOnly: boolean };
    expect(oldState.readOnly).toBe(true);
  });
});
