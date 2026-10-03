import { useState } from 'react';
import { z } from 'zod';
import { eventFileSchema } from '../domain/schema';
import type { ChangeSummary, DraftEnvelope, FrozenPreview, OperatorState, PreflightResult, PublishJob, PublishStatus } from './contracts';
import { VERIFY_GRACE_MS } from './contracts';
import { pushedAtMs } from './contracts';
import type { useOperator } from './useOperator';
import { PreviewFrame } from './PreviewFrame';

type Workbench = ReturnType<typeof useOperator>;
const STATUS: Record<PublishStatus, string> = {
  checking: '检查中', saving: '准备数据', committing: '正在提交', committed: '已提交，未推送',
  pushing: '正在推送', deploying: '已推送，等待部署', live: '观众已可见',
  unverified: '已推送 · 未核验', failed: '发布未完成',
};

/**
 * "已推送但等核验超时"的任务不再阻塞下一批发布。
 *
 * 与后端 `isStaleVerification` 同一口径（都用 `pushedAtMs` 与 `VERIFY_GRACE_MS`）：
 * 部署失败时公开站点永远不会出现该版本，GitHub API 又可能限流查不到结论，
 * 任务会永久停在"等待部署"。这种事不该挡住录入成绩的发布。
 */
function pendingVerification(jobs: PublishJob[]): PublishJob | null {
  const now = Date.now();
  return jobs.find((job) => {
    if (job.status !== 'deploying') return false;
    const since = pushedAtMs(job);
    return since !== null && now - since >= VERIFY_GRACE_MS;
  }) ?? null;
}

export function downloadDraft(draft: DraftEnvelope) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `rg26-local-draft-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  // Chromium may start reading the URL after click() returns; keep it alive for the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ChangesTable({ changes }: { changes: ChangeSummary[] }) {
  if (!changes.length) return <p className="muted">赛事数据尚无待发布变更。未完成输入单独保存在本地草稿。</p>;
  return <div className="operator-changes"><table className="table"><thead><tr><th>变更项目</th><th>原内容</th><th>新内容</th></tr></thead>
    <tbody>{changes.map((change) => <tr key={change.path}><th scope="row">{change.label}</th><td>{change.before || '未填写'}</td><td>{change.after || '未填写'}</td></tr>)}</tbody>
  </table></div>;
}

export function PublishPanel({ workbench }: { workbench: Workbench }) {
  const { draft, state, client, flush, updateEvent, refresh, pending } = workbench;
  const [check, setCheck] = useState<PreflightResult | null>(null);
  const [preview, setPreview] = useState<FrozenPreview | null>(() => workbench.state?.preview ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [migrationReviewed, setMigrationReviewed] = useState(false);
  const [message, setMessage] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  if (!draft || !state) return null;
  const readOnly = state.readOnly;
  const operation = async (label: string, run: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(null); }
  };
  const validate = () => operation('核对变更', async () => {
    const saved = await flush(); if (!saved || !client.current) return;
    setCheck(await client.current.request<PreflightResult>('/validate', 'POST', { expectedVersion: saved.version }));
    setConfirmation(false);
  });
  const createPreview = () => operation('生成预览', async () => {
    const saved = await flush(); if (!saved || !client.current) return;
    const prepared = await client.current.request<FrozenPreview>('/preview', 'POST', { expectedVersion: saved.version });
    setPreview(prepared); setConfirmation(false);
  });
  const publish = () => operation('发起发布', async () => {
    if (!preview || !confirmation || !client.current) return;
    const saved = await flush();
    if (saved?.version !== preview.draftVersion) throw new Error('草稿已更新，请重新预览最新版本后再发布。');
    await client.current.request<PublishJob>('/publish', 'POST', { expectedVersion: preview.draftVersion, previewId: preview.id,
      message: message.trim() || '更新赛事结果与日程' });
    setConfirmation(false); setPreview(null); setCheck(null); setMessage(''); await refresh();
  });
  const currentPreview = !!preview && preview.draftVersion === draft.version && !pending;
  /*
   * 只有"真正还在进行"的任务才挡住发布：终态（live/failed/unverified）与
   * "已推送、等核验超时"的都不挡。等核验超时的那一个改为显示说明。
   */
  const activeJob = state.jobs.some((job) => !['live', 'failed', 'unverified'].includes(job.status) && job !== pendingVerification(state.jobs));
  const stalledJob = pendingVerification(state.jobs);
  const changes = currentPreview ? preview.changes : check?.changes ?? [];
  return <div className="operator-publish stack">
    <section className="card"><div className="card__head"><h2>核对与发布</h2><span className="badge badge--neutral">草稿版本 {draft.version}</span></div>
      <ol className="operator-publish-steps"><li>保存草稿</li><li>核对变更</li><li>观众预览</li><li>确认发布</li><li>验证上线</li></ol>
      <p>先核对累计变更，再预览观众将看到的内容。发布后会持续检查部署和公开站点，直到本次版本确实可见。</p>
      <div className="row"><button type="button" className="btn" disabled={!!busy || readOnly} onClick={() => void validate()}>核对累计变更</button>
        <button type="button" className="btn btn--primary" disabled={!!busy || readOnly || draft.migrationRequiresReview} onClick={() => void createPreview()}>生成观众预览</button>
        {busy && <span role="status">{busy}…</span>}</div>
      {error && <div role="alert" className="operator-errors">{error}</div>}
      {check && !currentPreview && <div className="operator-preflight">
        <h3>本次累计变更 · {check.changes.length} 项</h3><ChangesTable changes={check.changes} />
        {!!check.errors.length && <div className="operator-errors"><strong>需处理后才能发布</strong><ul>{check.errors.map((text) => <li key={text}>{text}</li>)}</ul></div>}
        {!!check.warnings.length && <details><summary>{check.warnings.length} 条核对提示</summary><ul>{check.warnings.map((text) => <li key={text}>{text}</li>)}</ul></details>}
      </div>}
      {draft.migrationRequiresReview && <section className="operator-warnings"><h3>旧草稿需要核对基础版本</h3>
        <p>此草稿来自旧浏览器或交接文件，不能直接认定为当前正式版本。请先核对上面的所有差异，再确认。</p>
        <label className="operator-check"><input type="checkbox" checked={migrationReviewed} disabled={!check || readOnly} onChange={(e) => setMigrationReviewed(e.target.checked)} />我已对照当前正式数据核对全部变更</label>
        <button className="btn" type="button" disabled={!migrationReviewed || !check || readOnly || !!busy} onClick={() => void operation('保存核对确认', async () => {
          updateEvent(draft.event, false); await flush(); setCheck(null); setMigrationReviewed(false);
        })}>确认基础版本核对完成</button>
      </section>}
    </section>
    {preview && <section className="card operator-frozen-preview"><h2>发布预览</h2>
      <p className="small muted">预览草稿版本 {preview.draftVersion} · {new Date(preview.createdAt).toLocaleString('zh-CN')}</p>
      {!currentPreview && <div className="operator-warnings">草稿在预览后有了新变化，请重新生成预览。</div>}
      <ChangesTable changes={preview.changes} /><PreviewFrame snapshot={preview.snapshot} />
      <div className="operator-field"><label htmlFor="publish-message">本次发布说明</label><input id="publish-message" className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="例如：公布第二轮成绩及下午时间调整" disabled={readOnly} /></div>
      <label className="operator-check"><input type="checkbox" checked={confirmation && currentPreview} disabled={!currentPreview || readOnly} onChange={(e) => setConfirmation(e.target.checked)} />已核对 {preview.changes.length} 项变更和观众预览，确认发布此版本</label>
      <button className="btn btn--primary" type="button" disabled={!confirmation || !currentPreview || readOnly || !!busy || activeJob || !changes.length} onClick={() => void publish()}>确认发布 {preview.changes.length} 项变更</button>
      {activeJob && <p className="small muted">上一项发布仍在进行。可以继续录入草稿，完成后再发布下一批。</p>}
      {!activeJob && stalledJob && <p className="operator-warnings">
        上一项发布已推送，但超过 {Math.round(VERIFY_GRACE_MS / 60_000)} 分钟仍未确认观众可见
        {stalledJob.targetRevision === preview.targetRevision ? '' : '（常见原因是部署失败，或 GitHub 部署状态无法查询）'}。
        <strong>这不影响继续发布下一批</strong>；如需确认那一次，可在下方发布记录里点"检查上线状态"，或打开其部署记录查看日志。
      </p>}
    </section>}
    <PublishHistory jobs={state.jobs} readOnly={readOnly} run={(job, action) => operation(action === 'check' ? '检查上线状态' : '重试发布', async () => {
      await client.current?.request(`/jobs/${encodeURIComponent(job.id)}/${action}`, 'POST', {}); await refresh();
    })} busy={!!busy} />
    <details className="card operator-emergency"><summary>交接、同步与应急工具</summary>
      <p className="small muted">正常录入会自动保存到本机。以下工具用于备份、交接或从远端同步最新正式数据。</p>
      <div className="row"><button type="button" className="btn" onClick={() => downloadDraft(draft)}>下载完整本地草稿</button>
        <label className="btn">导入交接文件<input type="file" accept="application/json,.json" className="visually-hidden" disabled={readOnly || !!busy} onChange={(e) => {
          const file = e.target.files?.[0]; if (!file) return;
          void operation('读取交接文件', async () => {
            const raw: unknown = JSON.parse(await file.text());
            const candidate = raw && typeof raw === 'object' && 'event' in raw && 'baseRevision' in raw ? raw.event : raw;
            const event = eventFileSchema.parse(candidate);
            const formInputs = raw && typeof raw === 'object' && 'formInputs' in raw
              ? z.record(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))).parse(raw.formInputs) : {};
            if (draft.dirty || Object.keys(draft.formInputs).length) downloadDraft(draft);
            // All external drafts are explicitly reviewed; an old base must never be silently adopted.
            workbench.update((current) => ({ ...current, event, formInputs, dirty: true, migrationRequiresReview: true }));
            await flush(); setCheck(null); setPreview(null);
          }); e.target.value = '';
        }} /></label>
        <button type="button" className="btn" disabled={readOnly || !!busy || draft.dirty || pending || Object.keys(draft.formInputs).length > 0} onClick={() => void operation('同步正式数据', async () => {
          const saved = await flush(); if (!saved || !client.current) return;
          await client.current.request<OperatorState>('/sync', 'POST', { expectedVersion: saved.version }); await refresh();
        })}>同步远端正式数据</button></div>
      {(draft.dirty || Object.keys(draft.formInputs).length > 0) && <p className="small muted">当前有未发布变更或未完成输入，先完成处理或备份并放弃草稿后再同步。导入交接文件前，会自动下载当前草稿备份。</p>}
      <details><summary>放弃本地草稿</summary><p>会丢弃未发布结果和未完成输入，恢复到当前正式源。建议先下载完整草稿备份。</p>
        <label className="operator-check"><input type="checkbox" checked={resetConfirm} onChange={(e) => setResetConfirm(e.target.checked)} />确认放弃本地草稿</label>
        <button className="btn" type="button" disabled={!resetConfirm || readOnly || !!busy} onClick={() => void operation('恢复正式数据', async () => {
          const saved = await flush(); if (!saved || !client.current) return;
          await client.current.request<DraftEnvelope>('/draft/reset', 'POST', { expectedVersion: saved.version }); await refresh();
          setCheck(null); setPreview(null); setResetConfirm(false);
        })}>放弃草稿并恢复正式数据</button>
      </details>
      <details><summary>发布环境</summary><p>分支：{state.git.branch} · 目标：origin/main</p>
        {state.git.blockers.length ? <ul>{state.git.blockers.map((text) => <li key={text}>{text}</li>)}</ul> : <p>发布环境检查通过。</p>}
        <p className="small muted">环境问题只影响发布，本地录入和预览可以继续。</p>
      </details>
    </details>
  </div>;
}

function PublishHistory({ jobs, readOnly, busy, run }: { jobs: PublishJob[]; readOnly: boolean; busy: boolean; run: (job: PublishJob, action: 'retry' | 'check') => Promise<unknown> }) {
  return <section className="card"><h2>发布记录</h2>{!jobs.length && <p className="muted">发布任务会保存在本机，关闭窗口后仍可继续查看。</p>}
    <div className="stack">{jobs.map((job) => <article key={job.id} className={`operator-job operator-job--${job.status}`}>
      <div className="row"><strong>{STATUS[job.status]}</strong><time className="small muted">{new Date(job.createdAt).toLocaleString('zh-CN')}</time></div>
      <p>{job.message}</p><p className="small muted">草稿版本 {job.draftVersion}{job.commit ? ` · 提交 ${job.commit.slice(0, 8)}` : ''}</p>
      {job.error && <p className="operator-field-error">{job.error}</p>}
      {(job.status === 'deploying' || job.status === 'unverified') && job.logs.some((log) => log.message.includes('部署状态暂不可查询')) &&
        <p className="operator-warnings">{[...job.logs].reverse().find((log) => log.message.includes('部署状态暂不可查询'))?.message}</p>}
      <div className="row">{job.status !== 'live' && <button type="button" className="btn btn--small" disabled={busy || readOnly} onClick={() => void run(job, 'check')}>检查上线状态</button>}
        {job.retryable && <button type="button" className="btn btn--small" disabled={busy || readOnly} onClick={() => void run(job, 'retry')}>从失败阶段重试</button>}
        {job.actionsUrl && <a href={job.actionsUrl} target="_blank" rel="noreferrer">查看部署记录</a>}
        {job.pagesUrl && <a href={job.pagesUrl} target="_blank" rel="noreferrer">打开观众站</a>}</div>
      <details><summary>任务日志</summary><ol>{job.logs.map((log) => <li key={log.id}><time>{new Date(log.at).toLocaleTimeString('zh-CN')}</time> {log.message}</li>)}</ol></details>
    </article>)}</div>
  </section>;
}
