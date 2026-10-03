import { useMemo, useRef, useState } from 'react';
import type { CorrectionDisposition, EventFile, ResultKind } from '../domain/schema';
import { formatTime, todayInEventTz } from '../data/view-model';
import { matchNumbersFor } from '../domain/match-numbers';
import { sidesForSeriesGame, sidesForSwiss, sideLabel } from '../domain/sides';
import { seriesWins, type ApplyResult } from './draft';
import { useFormField, type FormInputs } from './FormDraftContext';
import { currentResult, proposeResult, resultParticipants, type ResultInput, type ResultProposal, type ResultTarget } from './result-edit';

const RESULT_KINDS: { value: ResultKind; label: string }[] = [
  { value: 'normal', label: '有效正常比赛' }, { value: 'early-end', label: '按规则提前结束' },
  { value: 'walkover-before-start', label: '未开赛弃权' }, { value: 'administrative-stop', label: '行政判负中止' },
];

/**
 * 各结果类型的录入口径（规则手册 §3.2.2 / §5.4 / §8.5 与赛程手册附一六）。
 *
 * 重点说清三类最容易录错的情形：0:0 仍分胜负、弃权不填积分、判负的胜者是谁。
 */
const RESULT_KIND_HINTS: Record<ResultKind, string> = {
  normal:
    '完整打完 6 分钟。双方积分都要填；积分为 0 的一方到达时间自动记 360 秒。' +
    '0:0 也可能有胜者——双方都没搭起来时，先成功抓取方块的一方胜，请照裁判记录选择胜者。',
  'early-end':
    '按规则提前结束（例如达到大胜条件，或可搭建方块耗尽）。' +
    '仍需填写双方积分；积分为 0 的一方到达时间自动记 360 秒。',
  'walkover-before-start':
    '未开赛弃权：不用填积分。胜者选「到场并按规则完成比赛」的一方。' +
    '该场不计入 A/B/P/T，但胜负、已登记对阵与对手强度 O 照常计入（可能因此达到 3 胜晋级或 3 败淘汰）。',
  'administrative-stop':
    '行政判负中止：不用填积分。胜者必须选「未被判罚」的一方——填反了会把胜负记反。' +
    '该场不计入 A/B/P/T，但胜负、已登记对阵与对手强度 O 照常计入。',
};

interface QueueItem { target: ResultTarget; title: string; names: string; date: string; time: string; status: string; venue: string; matchNo: number | null }
type WorkbenchResult = ApplyResult & { clearFormKey?: string };

function buildQueue(event: EventFile, forms: FormInputs): QueueItem[] {
  const names = (ids: readonly string[]) => ids.map((id) => event.teams.find((t) => t.id === id)?.name ?? id).join(' / ');
  // 全局比赛编号（排位赛 1–44、瑞士轮 45–77、决赛 78–91）：现场播报与核对时按它叫场。
  const numbers = matchNumbersFor(event).byId;
  return event.scheduleItems.flatMap((item): QueueItem[] => {
    const run = event.qualification.runs.find((r) => r.scheduleItemId === item.id);
    const match = event.swiss.matches.find((m) => m.scheduleItemId === item.id);
    const series = event.finals.series.find((s) => s.scheduleItemId === item.id && s.countsForStandings);
    if (!run && !match && !series) return [];
    const target: ResultTarget = { kind: run ? 'qualification' : match ? 'swiss' : 'finals', id: (run ?? match ?? series)!.id, gameIndex: 1 };
    const participants = run ? [run.teamId] : resultParticipants(event, target) ?? [];
    const confirmed = run ? run.resultStatus === 'confirmed' : match ? currentResult(event, target)?.resultStatus === 'confirmed' : !!seriesWins(series!).winnerId;
    const hasInput = Object.keys(forms).some((key) => key.startsWith(`result:${target.kind}:${target.id}:`));
    const provisional = run?.resultStatus === 'provisional' || (series?.games.some((g) => g.resultStatus === 'confirmed') ?? false);
    return [{ target, title: item.title, names: participants.length ? names(participants) : '对阵待公布',
      matchNo: numbers.get(target.id) ?? null,
      date: (item.revisedStart ?? item.plannedStart).slice(0, 10), time: item.revisedStart ?? item.plannedStart,
      venue: event.venues.find((v) => v.id === item.venueId)?.label ?? '场地待定',
      status: confirmed ? '已确认' : provisional || hasInput ? '待确认' : '待录入' }];
  }).sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'zh-CN'));
}

export function ResultWorkbench({ draft, formInputs, onApply }: {
  draft: EventFile; formInputs: FormInputs; onApply: (result: WorkbenchResult) => void;
}) {
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [selection, setSelection] = useState<string | null>(() => {
    const initial = buildQueue(draft, formInputs);
    return (initial.find((item) => item.date === todayInEventTz(new Date()) && item.status !== '已确认') ?? initial[0])?.target.id ?? null;
  });
  const queue = useMemo(() => buildQueue(draft, formInputs), [draft, formInputs]);
  const dates = [...new Set(queue.map((item) => item.date))];
  const shown = queue.filter((item) => (!date || item.date === date) && (!status || item.status === status) &&
    `${item.title} ${item.names} ${item.target.id} 第${item.matchNo ?? ''}场`.toLowerCase().includes(search.toLowerCase()));
  const selected = queue.find((item) => item.target.id === selection) ??
    shown.find((item) => item.date === todayInEventTz(new Date()) && item.status !== '已确认') ?? shown[0];
  const next = () => {
    const index = shown.findIndex((item) => item.target.id === selected?.target.id);
    const following = shown[index + 1] ?? shown.find((item) => item.status !== '已确认' && item.target.id !== selected?.target.id);
    if (following) setSelection(following.target.id);
  };
  return <div className="operator-grid">
    <aside className="operator-queue" aria-label="比赛录入队列">
      <div className="operator-queue__head">
        <h2>比赛队列 <span className="muted small">{shown.length} 项</span></h2>
        <label className="visually-hidden" htmlFor="operator-search">搜索队伍或比赛</label>
        <input id="operator-search" type="search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索队伍或比赛" />
        <div className="operator-inline">
          <select className="select" aria-label="比赛日期" value={date} onChange={(e) => setDate(e.target.value)}>
            <option value="">全部日期</option>{dates.map((day) => <option key={day} value={day}>{day.slice(5)}</option>)}
          </select>
          <select className="select" aria-label="录入状态" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>{['待录入', '待确认', '已确认'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
      </div>
      <div className="operator-list">
        {shown.map((item) => <button key={item.target.id} type="button" className="operator-item"
          aria-current={selected?.target.id === item.target.id} onClick={() => setSelection(item.target.id)}>
          <span className="operator-item__time">{item.date.slice(5)} · {formatTime(item.time)}{item.matchNo !== null ? ` · 第 ${item.matchNo} 场` : ''} <span>{item.status}</span></span>
          <strong>{item.title}</strong><span>{item.names}</span><small>{item.venue}</small>
        </button>)}
        {!shown.length && <p className="empty">没有符合条件的比赛。</p>}
      </div>
    </aside>
    <div className="operator-result-panel">
      {selected ? <ContestEditor key={selected.target.id} item={selected} draft={draft} onApply={onApply} onNext={next} /> :
        <p className="empty">赛程中的比赛会出现在这里。</p>}
    </div>
  </div>;
}

function ContestEditor({ item, draft, onApply, onNext }: { item: QueueItem; draft: EventFile; onApply: (r: WorkbenchResult) => void; onNext: () => void }) {
  const series = item.target.kind === 'finals' ? draft.finals.series.find((s) => s.id === item.target.id) : null;
  const [gameIndex, setGameIndex] = useState(() => series?.games.find((g) => g.resultStatus !== 'confirmed')?.index ?? 1);
  const wins = series ? seriesWins(series) : null;
  return <section className="card operator-editor">
    <div className="operator-editor__heading"><div><p className="operator-eyebrow">{item.date} · {formatTime(item.time)} · {item.venue}{item.matchNo !== null ? ` · 第 ${item.matchNo} 场` : ''}</p>
      <h2>{item.title}</h2><p className="muted">{item.names}</p></div><span className="badge badge--neutral">{item.status}</span></div>
    {series && series.format !== 'BO1' && <div className="operator-games">
      <strong>系列赛比分 {wins?.home} : {wins?.away}</strong>
      <div className="segmented" aria-label="选择小局">{series.games.map((game) => <button type="button" className="segmented__item" key={game.index}
        aria-pressed={gameIndex === game.index} disabled={!!wins?.winnerId && game.resultStatus !== 'confirmed'} onClick={() => setGameIndex(game.index)}>
        第 {game.index} 局{game.resultStatus === 'confirmed' ? ' · 已确认' : wins?.winnerId ? ' · 无需进行' : ''}
      </button>)}</div>
      <p className="small muted">全系列赛不换边，先赢 2 局结束。小局输入分别保存。</p>
    </div>}
    <ResultEditor key={`${item.target.id}:${gameIndex}`} target={{ ...item.target, gameIndex }} draft={draft} onApply={onApply} onNext={(nextEvent) => {
      const updated = nextEvent.finals.series.find((s) => s.id === item.target.id);
      const nextGame = updated?.games.find((g) => g.resultStatus !== 'confirmed');
      if (updated && updated.format !== 'BO1' && !seriesWins(updated).winnerId && nextGame) setGameIndex(nextGame.index); else onNext();
    }} />
  </section>;
}

function ResultEditor({ target, draft, onApply, onNext }: { target: ResultTarget; draft: EventFile; onApply: (r: WorkbenchResult) => void; onNext: (event: EventFile) => void }) {
  const key = `result:${target.kind}:${target.id}:${target.gameIndex}`;
  const current = currentResult(draft, target);
  // Individual hooks preserve incomplete values immediately, without promoting them into official results.
  const [homeScore, setHomeScore] = useFormField(key, 'homeScore', current && 'homeScore' in current ? current.homeScore ?? '' : current && 'score' in current ? current.score ?? '' : '');
  const [awayScore, setAwayScore] = useFormField(key, 'awayScore', current && 'awayScore' in current ? current.awayScore ?? '' : '');
  const [homeSeconds, setHomeSeconds] = useFormField(key, 'homeSeconds', current && 'homeReachedSeconds' in current ? current.homeReachedSeconds ?? '' : current && 'elapsedSeconds' in current ? current.elapsedSeconds ?? '' : '');
  const [awaySeconds, setAwaySeconds] = useFormField(key, 'awaySeconds', current && 'awayReachedSeconds' in current ? current.awayReachedSeconds ?? '' : '');
  const [winnerId, setWinnerId] = useFormField<string | null>(key, 'winnerId', current && 'winnerId' in current ? current.winnerId : null);
  const [resultKind, setResultKind] = useFormField<ResultKind>(key, 'resultKind', current && 'resultKind' in current ? current.resultKind : 'normal');
  const [note, setNote] = useFormField(key, 'note', current && 'note' in current ? current.note ?? '' : current && 'judgeNote' in current ? current.judgeNote ?? '' : '');
  const [rawResult, setRawResult] = useFormField(key, 'rawResult', current && 'rawResult' in current ? current.rawResult ?? '' : '');
  const [operation, setOperation] = useFormField<ResultInput['operation']>(key, 'operation', 'entry');
  const [reason, setReason] = useFormField(key, 'reason', '');
  const [disposition, setDisposition] = useFormField<CorrectionDisposition>(key, 'disposition', 'pending');
  const [dispositionNote, setDispositionNote] = useFormField(key, 'dispositionNote', '');
  const [proposal, setProposal] = useState<ResultProposal | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const input: ResultInput = { homeScore, awayScore, homeSeconds, awaySeconds, winnerId, resultKind, note, rawResult, operation, reason, disposition, dispositionNote };
  const participants = resultParticipants(draft, target);
  const match = draft.swiss.matches.find((m) => m.id === target.id);
  const sides = target.kind === 'swiss' ? sidesForSwiss(match?.roundIndex ?? 1) : sidesForSeriesGame(target.gameIndex);
  const name = (id: string) => draft.teams.find((t) => t.id === id)?.name ?? id;
  const isQualification = target.kind === 'qualification';
  const isPerformance = resultKind === 'normal' || resultKind === 'early-end';
  const confirmed = current?.resultStatus === 'confirmed';
  const submit = (next: boolean, confirm = true) => {
    const result = proposeResult(draft, target, input, confirm);
    setProposal(result);
    if (!result.ok) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    onApply({ ...result, clearFormKey: key });
    if (next) onNext(result.event);
  };
  const error = (name: string) => proposal?.fields[name] ? <span id={`error-${name}`} className="operator-field-error">{proposal.fields[name]}</span> : null;
  const numeric = (id: string, label: string, value: string, setter: (v: string) => void) => <div className="operator-field">
    <label htmlFor={`result-${id}`}>{label}</label><input id={`result-${id}`} name={id} className="input" inputMode="decimal"
      value={value} onChange={(e) => setter(e.target.value)} aria-invalid={!!proposal?.fields[id]} aria-describedby={proposal?.fields[id] ? `error-${id}` : undefined} />{error(id)}
  </div>;
  if (!isQualification && !participants) return <div className="empty">对阵尚未公布。请在“对阵与排名”中先确认对阵。</div>;
  return <div ref={formRef} className="operator-result-form">
    {confirmed && <div className="operator-warnings"><strong>这条结果已经确认</strong><p>修正录入错误请选择“更正”；比赛重新进行请选择“重赛”。两种操作都会保留旧值和原因。</p>
      <label htmlFor="result-operation">本次操作</label><select id="result-operation" className="select" value={operation} aria-invalid={!!proposal?.fields.operation} onChange={(e) => setOperation(e.target.value as ResultInput['operation'])}>
        <option value="entry">请选择更正或重赛</option><option value="correction">更正已记录结果</option><option value="replay">记录重新进行的比赛</option>
      </select>{error('operation')}
    </div>}
    {isQualification ? <>
      <div className="operator-field"><label htmlFor="result-rawResult">成绩文字</label><input id="result-rawResult" className="input" value={rawResult} aria-invalid={!!proposal?.fields.rawResult} onChange={(e) => setRawResult(e.target.value)} placeholder="例如：完成 / 超时" />{error('rawResult')}</div>
      <div className="operator-score-grid">{numeric('homeScore', '积分', homeScore, setHomeScore)}{numeric('homeSeconds', '到达最终分时间（秒）', homeSeconds, setHomeSeconds)}</div>
      <p className="small muted">确认后按既有排名规则更新排名；未完成的输入也会自动保存。</p>
    </> : <>
      <div className="operator-score-sides">{participants!.map((id, index) => <div className={`operator-score-side operator-score-side--${index === 0 ? sides.first : sides.second}`} key={id}>
        <h3><span>{sideLabel(index === 0 ? sides.first : sides.second)}</span> {name(id)}</h3>
        {isPerformance && <>{numeric(index === 0 ? 'homeScore' : 'awayScore', '积分', index === 0 ? homeScore : awayScore, index === 0 ? setHomeScore : setAwayScore)}
          {numeric(index === 0 ? 'homeSeconds' : 'awaySeconds', '到达最终分时间（秒）', index === 0 ? homeSeconds : awaySeconds, index === 0 ? setHomeSeconds : setAwaySeconds)}</>}
      </div>)}</div>
      <fieldset className="operator-winner"><legend>裁判确认胜者</legend>
        {participants!.map((id) => <button className="btn" type="button" key={id} aria-pressed={winnerId === id} aria-invalid={!!proposal?.fields.winnerId} onClick={() => setWinnerId(id)}>{name(id)}</button>)}
        {error('winnerId')}<p className="small muted">软件不代替裁判判定胜者。0:0 也可能有胜者（先成功抓取方块的一方）；零分局到达时间按约定记 360 秒。</p>
      </fieldset>
      <div className="operator-field"><label htmlFor="result-kind">结果类型</label><select id="result-kind" className="select" value={resultKind} onChange={(e) => setResultKind(e.target.value as ResultKind)}>
        {RESULT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select>
        <p className="xsmall muted" style={{ marginTop: 4 }}>{RESULT_KIND_HINTS[resultKind]}</p>
      </div>
    </>}
    <div className="operator-field"><label htmlFor="result-note">裁判备注（可选）</label><textarea id="result-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
    {confirmed && <section className="operator-correction"><h3>影响核对与处置</h3>
      <div className="operator-field"><label htmlFor="result-reason">{operation === 'replay' ? '重赛' : '更正'}原因</label><input id="result-reason" className="input" value={reason} aria-invalid={!!proposal?.fields.reason} onChange={(e) => setReason(e.target.value)} />{error('reason')}</div>
      <button type="button" className="btn" onClick={() => setProposal(proposeResult(draft, target, input))}>分析更正影响</button>
      {proposal?.impact && <div className="operator-impact"><p>排名变化 {proposal.impact.rankingChanges.length} 支队伍；受影响后续轮次 {proposal.impact.affectedPublishedRounds.length} 轮；决赛 {proposal.impact.affectedSeries.length} 场。</p>
        {[...proposal.impact.blockers, ...proposal.impact.warnings].map((text) => <p key={text}>{text}</p>)}</div>}
      <div className="operator-field"><label htmlFor="result-disposition">处置方式</label><select id="result-disposition" className="select" value={disposition} aria-invalid={!!proposal?.fields.disposition} onChange={(e) => setDisposition(e.target.value as CorrectionDisposition)}>
        <option value="pending">分析后选择（无下游时自动处理）</option><option value="keep-published-with-note">保留已公布对阵并说明</option><option value="republish">作废尚未开赛的对阵，重新公布</option><option value="committee-revision-recorded">记录组委会修订，保留已开赛比赛</option>
      </select>{error('disposition')}</div>
      <div className="operator-field"><label htmlFor="result-dispositionNote">处置说明</label><textarea id="result-dispositionNote" className="input" value={dispositionNote} aria-invalid={!!proposal?.fields.dispositionNote} onChange={(e) => setDispositionNote(e.target.value)} rows={2} />{error('dispositionNote')}</div>
    </section>}
    {proposal && <div role="status" className={proposal.ok ? 'operator-ok' : 'operator-errors'}>{proposal.messages.map((text) => <p key={text}>{text}</p>)}</div>}
    <div className="operator-editor__actions"><button type="button" className="btn btn--primary" onClick={() => submit(false)}>保存并确认结果</button>
      <button type="button" className="btn" onClick={() => submit(true)}>保存并录入下一场</button>
      {isQualification && !confirmed && <button type="button" className="btn" onClick={() => submit(false, false)}>保存为待确认</button>}
    </div>
    <p className="small muted">确认结果仅写入本地草稿；完成核对后，通过“预览与发布”统一发布。</p>
  </div>;
}
