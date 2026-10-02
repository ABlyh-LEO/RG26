import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { changePackageSchema, eventFileSchema } from '../../src/domain/schema';
import { OperatorService, checkEvent } from './service';
import { revision } from './storage';
import { git } from './git';

/** Both entry points share checks and transactions; dry runs never initialize storage. */
export async function runPublish(root: string, args: string[], output: (message: string) => void = console.log): Promise<number> {
  const { values } = parseArgs({ args, options: {
    file: { type: 'string' }, message: { type: 'string', short: 'm' },
    'dry-run': { type: 'boolean' }, 'no-push': { type: 'boolean' }, retry: { type: 'string' },
  } });
  if ((!values.file && !values.retry) || (values.retry && (values.file || values['dry-run'] || values['no-push'])) || (values['dry-run'] && values['no-push'])) {
    output('用法：npm run publish -- --file <变更包.json> -m "说明" [--dry-run | --no-push]');
    output('重试已有提交：npm run publish -- --retry <任务ID>');
    return 2;
  }
  const sourceEvent = eventFileSchema.parse(JSON.parse(await readFile(join(root, 'data/event.json'), 'utf8')));
  const source = { event: sourceEvent, revision: revision(sourceEvent), commit: await git(root, ['rev-parse', 'HEAD']).catch(() => null) };
  const pkg = values.file ? changePackageSchema.parse(JSON.parse(await readFile(resolve(values.file), 'utf8'))) : null;
  if (pkg) {
    const check = await checkEvent(root, source, pkg.event, pkg.baseRevision, false, process.env.OPERATOR_PAGES_URL);
    output(JSON.stringify({ changes: check.changes, errors: check.errors, warnings: check.warnings, publishBlockers: check.git.blockers }, null, 2));
    if (!check.ok) return 1;
    if (values['dry-run']) {
      output('只读检查完成。源文件、公开快照、Git 暂存区和本机草稿均未修改。');
      return check.git.blockers.length ? 1 : 0;
    }
  }
  const service = new OperatorService(root, { pagesUrl: process.env.OPERATOR_PAGES_URL });
  try {
    await service.initialize();
    let job;
    if (values.retry) job = await service.retry(values.retry);
    else {
      const state = await service.state();
      if (state.draft.dirty || Object.keys(state.draft.formInputs).length) throw new Error('本机还有工作台草稿，请先在工作台发布或明确放弃，避免命令覆盖它。');
      if (state.source.revision !== pkg!.baseRevision) throw new Error('预检查后正式源版本已变化，变更包未导入；请先处理基础版本冲突。');
      const draft = await service.save({ expectedVersion: state.draft.version, event: pkg!.event, message: '导入变更包' });
      const preview = await service.preview(draft.version);
      job = await service.publish({ expectedVersion: draft.version, previewId: preview.id, message: values.message }, !values['no-push']);
    }
    job = await service.waitForJob(job.id);
    for (const entry of job.logs) output(`${entry.at} ${entry.message}`);
    output(`任务：${job.id}；状态：${job.status}；提交：${job.commit ?? '尚未提交'}`);
    if (job.status === 'failed') {
      output(job.error ?? '发布失败');
      if (job.retryable) output(`可重试同一提交：npm run publish -- --retry ${job.id}`);
      return 1;
    }
    if (job.status === 'deploying') output('推送成功，尚未确认上线。打开工作台后会继续核验公开站点 revision 与 commit。');
    return 0;
  } finally { await service.close(); }
}
