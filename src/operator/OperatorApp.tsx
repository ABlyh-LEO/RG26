import { useState } from 'react';
import { eventFileSchema, type EventFile } from '../domain/schema';
import { canExportOfficial } from '../domain/corrections';
import { preflight, type ApplyResult } from './draft';
import { useOperator } from './useOperator';
import { FormDraftProvider } from './FormDraftContext';
import { ResultWorkbench } from './ResultWorkbench';
import { QualificationEntry, RoundsEntry, SeedsEntry, ShowcaseEntry, NoticesEntry } from './PlanningPanels';
import { PublishPanel, downloadDraft } from './PublishPanel';

type Tab = 'workbench' | 'planning' | 'notices' | 'publishing';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'workbench', label: '赛事工作台', icon: 'M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2' },
  { key: 'planning', label: '对阵与排名', icon: 'M4 4h5v5H4z M15 15h5v5h-5z M4 15h5v5H4z M9 6h8v9 M9 17h6' },
  { key: 'notices', label: '公告与日程', icon: 'M4 10v6h4l11 4V5L8 10z M8 16l2 5 M22 10v5' },
  { key: 'publishing', label: '发布记录', icon: 'M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7' },
];

function legacyDraft(): EventFile | null {
  try {
    if (sessionStorage.getItem('rg26.operator.legacy-dismissed')) return null;
    const raw = localStorage.getItem('rg26.operator.draft.v1');
    if (!raw) return null;
    const parsed = eventFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function OperatorApp() {
  const workbench = useOperator();
  const { state, draft, error, saving, pending, updateForm, flush, reload, takeover } = workbench;
  const [tab, setTab] = useState<Tab>('workbench');
  const [planning, setPlanning] = useState<'qualification' | 'rounds' | 'seeds' | 'showcase'>('qualification');
  const [messages, setMessages] = useState<string[]>([]);
  const [legacy, setLegacy] = useState(legacyDraft);
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const report = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); } catch (cause) { setMessages([cause instanceof Error ? cause.message : '操作失败']); }
    finally { setBusy(false); }
  };
  const apply = (result: ApplyResult & { clearFormKey?: string; clearFormKeys?: string[] }) => {
    setMessages(result.messages);
    if (result.ok) workbench.update((current) => {
      const formInputs = { ...current.formInputs };
      for (const key of [...(result.clearFormKeys ?? []), ...(result.clearFormKey ? [result.clearFormKey] : [])]) delete formInputs[key];
      return { ...current, event: result.event, dirty: true, formInputs };
    });
  };
  if (!draft || !state) return <main className="operator-loading"><div className="operator-brand-mark">RG26</div><h1>本地赛事工作台</h1>
    {error ? <><div role="alert" className="operator-errors">{error}</div><p>请双击 start-operator.cmd 或运行 npm run operator。</p>
      <button type="button" className="btn btn--primary" onClick={() => void reload()}>重新连接</button></> : <p role="status">正在读取正式源与恢复本地草稿…</p>}</main>;
  const check = preflight(draft.event);
  const correctionGate = canExportOfficial(draft.event);
  const problems = [...check.errors, ...correctionGate.reasons];
  const preparingCommit = state.jobs.some((job) => ['checking', 'saving', 'committing'].includes(job.status));
  const hasDraftContent = draft.dirty || Object.keys(draft.formInputs).length > 0;
  return <div className="operator-shell">
    <header className="operator-header"><div className="operator-brand"><span className="operator-brand-mark">RG26</span><div><h1>赛事工作台</h1><p>本地维护 · 草稿不会自动发布</p></div></div>
      <div className="operator-header__actions"><span role="status" className={`operator-save-status ${pending ? 'operator-save-status--pending' : ''}`}>
        {state.readOnly ? '只读会话' : saving ? '正在保存…' : pending ? '有待保存输入' : '草稿已自动保存'}
      </span><button type="button" className="btn btn--primary" onClick={() => setTab('publishing')}>预览与发布</button></div>
    </header>
    <div className="operator-layout"><nav className="operator-nav" aria-label="维护功能">{TABS.map((item) => <button key={item.key} type="button"
      className="operator-nav__item" aria-current={tab === item.key ? 'page' : undefined} onClick={() => setTab(item.key)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={item.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>{item.label}
    </button>)}<div className="operator-nav__meta"><p>{draft.event.event.name}</p><span>草稿版本 {draft.version}</span><span>基础版本 {draft.baseRevision.slice(0, 8)}</span><span>最近保存 {new Date(draft.updatedAt).toLocaleTimeString('zh-CN')}</span></div></nav>
      <main className="operator-main">
        {state.readOnly && <section className="operator-warnings"><strong>另一个窗口正在维护赛事，本窗口为只读</strong><p>如需在这里继续，请明确接管。原窗口会变为只读，已保存草稿会保留。</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void report(takeover)}>接管编辑</button></section>}
        {error && <section className="operator-errors" role="alert"><strong>{error}</strong><p>此窗口中的输入尚未丢失。版本冲突时，请先备份，再载入服务端草稿。</p>
          <div className="row"><button type="button" className="btn" disabled={busy || state.readOnly} onClick={() => void report(flush)}>重试保存</button>
            <button type="button" className="btn" onClick={() => downloadDraft(draft)}>备份此窗口草稿</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void report(async () => { downloadDraft(draft); await reload(); })}>备份并载入服务端草稿</button></div></section>}
        {legacy && !state.readOnly && <section className="operator-warnings"><h2>发现旧浏览器草稿</h2><p>旧草稿没有可信的基础版本。导入后需在发布记录页对照正式数据核对差异，才能发布。</p>
          {hasDraftContent && <label className="operator-check"><input type="checkbox" checked={importConfirmed} onChange={(e) => setImportConfirmed(e.target.checked)} />允许旧草稿替换当前本地版本，导入前会下载包含未完成输入的完整备份</label>}
          <div className="row"><button type="button" className="btn" disabled={busy || (hasDraftContent && !importConfirmed)} onClick={() => void report(async () => {
            if (hasDraftContent) downloadDraft(draft);
            workbench.update((current) => ({ ...current, event: legacy, formInputs: {}, dirty: true, migrationRequiresReview: true }));
            await flush(); setLegacy(null); setTab('publishing'); sessionStorage.setItem('rg26.operator.legacy-dismissed', '1');
          })}>导入旧草稿并核对差异</button><button type="button" className="btn" onClick={() => { setLegacy(null); sessionStorage.setItem('rg26.operator.legacy-dismissed', '1'); }}>暂不导入</button></div></section>}
        {!!problems.length && <details className="operator-errors"><summary>{problems.length} 项待处理问题，处理后才能发布</summary><ul>{problems.map((text) => <li key={text}>{text}</li>)}</ul></details>}
        {preparingCommit && <p className="operator-summary" role="status">正在保存本次发布版本，录入暂时锁定。提交完成后即可继续录入下一批。</p>}
        {!!messages.length && <div className="operator-feedback" role="status">{messages.map((text) => <p key={text}>{text}</p>)}<button className="btn btn--small" type="button" onClick={() => setMessages([])} aria-label="收起操作提示">收起</button></div>}
        <FormDraftProvider inputs={draft.formInputs} update={updateForm}>
          <fieldset className="operator-editable" disabled={state.readOnly || preparingCommit}>
            {tab === 'workbench' && <ResultWorkbench draft={draft.event} formInputs={draft.formInputs} onApply={apply} />}
            {tab === 'planning' && <div className="stack"><header className="operator-page-heading"><h2>对阵与排名</h2><p>从确认原始成绩，到公布下一轮对阵；所有操作先进入本地草稿。</p></header>
              <div className="segmented" aria-label="对阵与排名功能">{([{ key: 'qualification', label: '排位赛排名' }, { key: 'rounds', label: '瑞士轮配对' }, { key: 'seeds', label: '八强种子' }, { key: 'showcase', label: '展示组抽签' }] as const).map((item) => <button key={item.key} type="button" className="segmented__item" aria-pressed={planning === item.key} onClick={() => setPlanning(item.key)}>{item.label}</button>)}</div>
              {planning === 'qualification' && <QualificationEntry draft={draft.event} onApply={apply} />}
              {planning === 'rounds' && <RoundsEntry draft={draft.event} onApply={apply} />}
              {planning === 'seeds' && <SeedsEntry draft={draft.event} onApply={apply} />}
              {planning === 'showcase' && <ShowcaseEntry draft={draft.event} onApply={apply} />}
            </div>}
            {tab === 'notices' && <div className="stack"><header className="operator-page-heading"><h2>公告与日程</h2><p>调整会显示原时间和说明；计划时间不会决定比赛实际状态。</p></header><NoticesEntry draft={draft.event} onApply={apply} /></div>}
          </fieldset>
        </FormDraftProvider>
        {tab === 'publishing' && <PublishPanel workbench={workbench} />}
      </main>
    </div>
  </div>;
}
