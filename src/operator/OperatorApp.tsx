/**
 * 维护工具界面。
 *
 * 设计要点：
 * - 明显标注“仅本机 / 未发布”，避免与正式站点混淆。
 * - 按当天赛程排序，支持比赛 ID 与队伍搜索。
 * - 普通 BO1 一次录入双方积分、到达最终分时间、胜者与异常类型，提交前显示摘要。
 * - BO3 逐局输入，自动显示系列赛比分。
 * - 所有操作先作用于本地草稿；导出变更包后才可能影响正式站点。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publicSnapshotSchema, type EventFile } from '../domain/schema';
import { fetchSnapshot, describeFailure, dataUrl } from '../data/snapshot';
import { formatTime, todayInEventTz } from '../data/view-model';
import {
  addNotice,
  applyBo1Entry,
  applyBo3Game,
  adjustSchedule,
  applyQualificationRanking,
  applyQualificationRun,
  confirmQualificationRuns,
  qualificationProgress,
  applyShowcaseDraw,
  buildChangePackage,
  confirmRound,
  generateNextRound,
  preflight,
  publishFinalsSeeding,
  publishRound,
  seriesWins,
  type PairingOutcome,
} from './draft';
import type { ResultKind, Series, SwissMatch } from '../domain/schema';
import { generateSwissPairings } from '../domain/swiss';

type Tab = 'matches' | 'bo3' | 'qualification' | 'qualRuns' | 'rounds' | 'seeds' | 'showcase' | 'notices' | 'export';

const TABS: { key: Tab; label: string }[] = [
  { key: 'matches', label: '录入比赛' },
  { key: 'bo3', label: 'BO3 小局' },
  { key: 'qualRuns', label: '排位赛成绩' },
  { key: 'qualification', label: '排位赛排名' },
  { key: 'rounds', label: '轮次与配对' },
  { key: 'seeds', label: '八强种子' },
  { key: 'showcase', label: '展示组抽签' },
  { key: 'notices', label: '公告与时间' },
  { key: 'export', label: '导出与发布' },
];

export function OperatorApp() {
  const [base, setBase] = useState<{ revision: string; event: EventFile } | null>(null);
  const [draft, setDraft] = useState<EventFile | null>(null);
  const [tab, setTab] = useState<Tab>('matches');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  /** 载入正式源数据作为基础版本（通过开发服务器直接读源文件）。 */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // 维护模式下 Vite 直接提供仓库根目录的 data/event.json
      const res = await fetch('/data/event.json?raw', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = publicSnapshotSchema.safeParse(await res.json());
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new Error(`源数据结构不符：${first ? `${first.path.join('.')} ${first.message}` : '未知'}`);
      }
      setBase({ revision: parsed.data.revision, event: parsed.data.data });
      setDraft(parsed.data.data);
      setDirty(false);
      setMessages([]);
    } catch (error) {
      // 回退：走公开快照读取路径
      try {
        const { raw } = await fetchSnapshot({ url: dataUrl('/') });
        const parsed = publicSnapshotSchema.safeParse(raw);
        if (!parsed.success) throw new Error('公开快照结构不符');
        setBase({ revision: parsed.data.revision, event: parsed.data.data });
        setDraft(parsed.data.data);
        setDirty(false);
      } catch {
        setLoadError(describeFailure(error));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 草稿写入本机存储；失败时明确提示并允许立即导出。 */
  const persistDraft = useCallback((next: EventFile) => {
    try {
      localStorage.setItem('rg26.operator.draft.v1', JSON.stringify(next));
      setStorageWarning(null);
    } catch {
      setStorageWarning('草稿保存失败（浏览器存储空间不足或被禁用）。请立即导出变更包，否则改动会丢失。');
    }
  }, []);

  const applyResult = useCallback(
    (result: { event: EventFile; ok: boolean; messages: string[] }) => {
      setMessages(result.messages);
      if (result.ok) {
        setDraft(result.event);
        setDirty(true);
        persistDraft(result.event);
      }
    },
    [persistDraft],
  );

  const check = useMemo(() => (draft ? preflight(draft) : null), [draft]);

  if (loading) return <div className="empty">正在载入正式源数据…</div>;

  if (loadError || !draft || !base) {
    return (
      <div style={{ padding: 'var(--sp-5)' }}>
        <h1>无法载入源数据</h1>
        <p className="muted">{loadError ?? '未知错误'}</p>
        <p className="small muted">
          请确认已运行 <code>npm run operator</code>，并且 <code>data/event.json</code> 存在。
        </p>
        <button type="button" className="btn btn--primary" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="operator-banner">
        <span className="operator-banner__tag">仅本机</span>
        <span>维护工具 · 127.0.0.1 · 草稿不会自动发布到公开站点</span>
        <span style={{ marginLeft: 'auto' }}>
          基础版本：<code>{base.revision.slice(0, 12)}</code>
          {dirty ? ' · 有未导出的改动' : ' · 无改动'}
        </span>
      </div>

      <div style={{ padding: 'var(--sp-4) var(--gutter)', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        {storageWarning ? <div className="operator-warnings" style={{ marginBottom: 'var(--sp-3)' }}>{storageWarning}</div> : null}

        {check && !check.ok ? (
          <div className="operator-errors" style={{ marginBottom: 'var(--sp-3)' }}>
            <strong>草稿存在 {check.errors.length} 条错误，无法发布：</strong>
            <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
              {check.errors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="operator-ok" style={{ marginBottom: 'var(--sp-3)' }}>
            草稿校验通过，可以导出发布。
            {check && check.warnings.length > 0 ? `（${check.warnings.length} 条提示不影响发布）` : ''}
          </div>
        )}

        {messages.length > 0 ? (
          <div className="operator-summary" style={{ marginBottom: 'var(--sp-3)' }}>
            {messages.map((m) => (
              <div key={m}>{m}</div>
            ))}
          </div>
        ) : null}

        <nav className="segmented" aria-label="维护功能" style={{ marginBottom: 'var(--sp-4)' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="segmented__item"
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'matches' ? <MatchEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'bo3' ? <Bo3Entry draft={draft} onApply={applyResult} /> : null}
        {tab === 'qualRuns' ? <QualRunsEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'qualification' ? <QualificationEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'rounds' ? <RoundsEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'seeds' ? <SeedsEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'showcase' ? <ShowcaseEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'notices' ? <NoticesEntry draft={draft} onApply={applyResult} /> : null}
        {tab === 'export' ? <ExportPanel draft={draft} baseRevision={base.revision} check={check} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 录入比赛
 * ------------------------------------------------------------------ */

const RESULT_KINDS: { value: ResultKind; label: string; hint: string }[] = [
  { value: 'normal', label: '有效正常比赛', hint: '双方计入表现统计、战绩与 O' },
  { value: 'early-end', label: '按规则提前结束', hint: '计入表现统计、战绩与 O' },
  { value: 'walkover-before-start', label: '未开赛弃权', hint: '不计入 A/B/P/T，但计入胜负与 O' },
  { value: 'administrative-stop', label: '行政判负中止', hint: '不计入 A/B/P/T，但计入胜负与 O' },
];

function MatchEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const today = todayInEventTz(new Date());

  // 按当天赛程排序，支持比赛 ID 与队伍搜索
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return draft.swiss.matches
      .map((m) => {
        const item = draft.scheduleItems.find((s) => s.id === m.scheduleItemId);
        const names = (m.participantSnapshot ?? [])
          .map((id) => draft.teams.find((t) => t.id === id)?.name ?? id)
          .join(' ');
        return { match: m, item, names };
      })
      .filter(({ match, item, names }) => {
        if (q === '') return true;
        return (
          match.id.toLowerCase().includes(q) ||
          names.toLowerCase().includes(q) ||
          (item?.title.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => {
        const da = a.item?.plannedStart ?? '';
        const db = b.item?.plannedStart ?? '';
        // 当天优先
        const aToday = a.item?.date === today ? 0 : 1;
        const bToday = b.item?.date === today ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        return da.localeCompare(db);
      });
  }, [draft, search, today]);

  const selected = selectedId ? draft.swiss.matches.find((m) => m.id === selectedId) ?? null : null;

  return (
    <div className="operator-grid">
      <div className="card">
        <div className="operator-field">
          <label htmlFor="match-search">搜索比赛 ID 或队伍</label>
          <input
            id="match-search"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="例如 swiss-r1-01-1 或 Uniforest"
          />
          <span className="operator-field__hint">共 {candidates.length} 场，当天赛程优先。</span>
        </div>
        <div className="operator-list">
          {candidates.slice(0, 200).map(({ match, item, names }) => {
            const effective = match.attempts.find((a) => a.id === match.effectiveAttemptId);
            return (
              <button
                key={match.id}
                type="button"
                className="operator-item"
                aria-current={selectedId === match.id}
                onClick={() => setSelectedId(match.id)}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong className="small">
                    R{match.roundIndex} · {match.groupRecord}
                  </strong>
                  <span className="xsmall muted tabular">
                    {item ? `${item.date.slice(5)} ${formatTime(item.plannedStart)}` : '—'}
                  </span>
                </div>
                <div className="xsmall muted">{names || '待定'}</div>
                <div className="row" style={{ gap: 'var(--sp-1)', marginTop: 2 }}>
                  <span className="xsmall muted">{match.id}</span>
                  {effective?.resultStatus === 'confirmed' ? (
                    <span className="badge badge--advanced">已确认</span>
                  ) : (
                    <span className="badge badge--pending">未录入</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {selected ? (
          <Bo1Form match={selected} draft={draft} onApply={onApply} />
        ) : (
          <div className="empty">从左侧选择一场比赛开始录入。</div>
        )}
      </div>
    </div>
  );
}

function Bo1Form({
  match,
  draft,
  onApply,
}: {
  match: SwissMatch;
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const participants = match.participantSnapshot;
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [homeSeconds, setHomeSeconds] = useState('');
  const [awaySeconds, setAwaySeconds] = useState('');
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [kind, setKind] = useState<ResultKind>('normal');
  const [note, setNote] = useState('');

  const nameOf = (id: string) => draft.teams.find((t) => t.id === id)?.name ?? id;
  const isPerformance = kind === 'normal' || kind === 'early-end';

  if (!participants) {
    return (
      <div className="card">
        <div className="empty">
          该比赛尚未确定参赛队伍（对阵未公布）。请先在「轮次与配对」中公布本轮对阵。
        </div>
      </div>
    );
  }

  const [homeId, awayId] = participants;

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">
          录入结果 · {match.id}
        </span>
        <span className="badge badge--neutral">
          R{match.roundIndex} · {match.groupRecord} 组第 {match.orderInGroup} 场
        </span>
      </div>

      <div className="operator-inline" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="operator-field">
          <label htmlFor="home-score">{nameOf(homeId)} 积分</label>
          <input id="home-score" className="input" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} inputMode="decimal" />
        </div>
        <div className="operator-field">
          <label htmlFor="home-sec">到达最终分时间（秒）</label>
          <input id="home-sec" className="input" value={homeSeconds} onChange={(e) => setHomeSeconds(e.target.value)} inputMode="decimal" />
          <span className="operator-field__hint">积分为 0 时自动记 360 秒</span>
        </div>
      </div>

      <div className="operator-inline" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="operator-field">
          <label htmlFor="away-score">{nameOf(awayId)} 积分</label>
          <input id="away-score" className="input" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} inputMode="decimal" />
        </div>
        <div className="operator-field">
          <label htmlFor="away-sec">到达最终分时间（秒）</label>
          <input id="away-sec" className="input" value={awaySeconds} onChange={(e) => setAwaySeconds(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--sp-3)' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 'var(--sp-1)' }}>
          胜者（必须由裁判确认，不自动推断）
        </legend>
        <div className="row">
          {[homeId, awayId].map((id) => (
            <button
              key={id}
              type="button"
              className="btn btn--small"
              aria-pressed={winnerId === id}
              onClick={() => setWinnerId(id)}
            >
              {nameOf(id)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="operator-field">
        <label htmlFor="result-kind">异常类型</label>
        <select id="result-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as ResultKind)}>
          {RESULT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="operator-field__hint">{RESULT_KINDS.find((k) => k.value === kind)?.hint}</span>
      </div>

      <div className="operator-field">
        <label htmlFor="note">备注（可选）</label>
        <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {/* 提交前摘要 */}
      <div className="operator-summary" style={{ marginBottom: 'var(--sp-3)' }}>
        <strong>提交前摘要</strong>
        <div>
          {nameOf(homeId)} {isPerformance ? homeScore || '—' : '（不计分）'} : {isPerformance ? awayScore || '—' : '（不计分）'}{' '}
          {nameOf(awayId)}
        </div>
        <div>胜者：{winnerId ? nameOf(winnerId) : '未选择'}</div>
        <div>类型：{RESULT_KINDS.find((k) => k.value === kind)?.label}</div>
        <div className="xsmall muted">
          {isPerformance ? '双方计入 A/B/P/T' : '双方不计入 A/B/P/T，但计入胜负与 O'}
        </div>
        {match.attempts.length > 0 ? (
          <div className="xsmall" style={{ color: 'var(--pending)' }}>
            本场已有 {match.attempts.length} 次记录，提交将作为重赛追加，旧记录保留但不再计入统计。
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={() =>
          onApply(
            applyBo1Entry(draft, {
              matchId: match.id,
              homeScore,
              awayScore,
              homeSeconds,
              awaySeconds,
              winnerId,
              resultKind: kind,
              note: note.trim() === '' ? null : note.trim(),
            }),
          )
        }
      >
        确认并写入草稿
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * BO3 小局
 * ------------------------------------------------------------------ */

function Bo3Entry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const bo3 = draft.finals.series.filter((s) => s.format === 'BO3' && s.countsForStandings);
  const [selectedId, setSelectedId] = useState<string | null>(bo3[0]?.id ?? null);
  const selected = draft.finals.series.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="operator-grid">
      <div className="card">
        <div className="card__head">
          <span className="card__title">BO3 系列赛</span>
        </div>
        {bo3.map((s) => {
          const w = seriesWins(s);
          return (
            <button
              key={s.id}
              type="button"
              className="operator-item"
              aria-current={selectedId === s.id}
              onClick={() => setSelectedId(s.id)}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong className="small">{s.id}</strong>
                <span className="small tabular">
                  {w.home} : {w.away}
                  {w.winnerId ? ' 已决出' : ''}
                </span>
              </div>
              <div className="xsmall muted">
                {s.id === 'F-QUAL' ? '总决赛名额争夺战' : '总决赛'} · 先赢 2 局者胜
              </div>
            </button>
          );
        })}
      </div>

      <div>
        {selected ? <Bo3Form series={selected} draft={draft} onApply={onApply} /> : <div className="empty">选择一组 BO3。</div>}
      </div>
    </div>
  );
}

function Bo3Form({
  series,
  draft,
  onApply,
}: {
  series: Series;
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const w = seriesWins(series);
  const snap = series.participantSnapshot;
  const [homeTeamId, setHomeTeamId] = useState(snap?.[0] ?? '');
  const [awayTeamId, setAwayTeamId] = useState(snap?.[1] ?? '');
  const [gameIndex, setGameIndex] = useState(1);
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [kind, setKind] = useState<ResultKind>('normal');

  const nameOf = (id: string) => draft.teams.find((t) => t.id === id)?.name ?? id;
  // 下一局序号：跳过已确认的局
  const nextIndex = [...series.games].sort((a, b) => a.index - b.index).find((g) => g.resultStatus !== 'confirmed')?.index ?? 1;
  const effectiveIndex = gameIndex || nextIndex;

  useEffect(() => {
    setGameIndex(nextIndex);
  }, [nextIndex]);

  const notNeeded = w.winnerId !== null;

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">{series.id} · 逐局录入</span>
        <span className="badge badge--info tabular">
          系列赛比分 {w.home} : {w.away}（先到 {w.need} 胜）
        </span>
      </div>

      {notNeeded ? (
        <div className="operator-warnings" style={{ marginBottom: 'var(--sp-3)' }}>
          该系列赛已由 {nameOf(w.winnerId!)} 取得 {w.need} 胜并结束。
          剩余小局标为“不需要进行”，不能再录入。
        </div>
      ) : null}

      <div className="operator-inline" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="operator-field">
          <label htmlFor="bo3-home">主方队伍</label>
          <select id="bo3-home" className="select" value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)}>
            <option value="">（选择）</option>
            {draft.teams
              .filter((t) => t.division === 'competitive')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div className="operator-field">
          <label htmlFor="bo3-away">客方队伍</label>
          <select id="bo3-away" className="select" value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)}>
            <option value="">（选择）</option>
            {draft.teams
              .filter((t) => t.division === 'competitive')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="operator-inline" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="operator-field">
          <label htmlFor="bo3-index">第几局</label>
          <select id="bo3-index" className="select" value={effectiveIndex} onChange={(e) => setGameIndex(Number(e.target.value))}>
            {series.games.map((g) => (
              <option key={g.index} value={g.index} disabled={g.resultStatus === 'confirmed'}>
                第 {g.index} 局{g.resultStatus === 'confirmed' ? '（已确认）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="operator-field">
          <label htmlFor="bo3-hs">主方积分</label>
          <input id="bo3-hs" className="input" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} inputMode="decimal" />
        </div>
        <div className="operator-field">
          <label htmlFor="bo3-as">客方积分</label>
          <input id="bo3-as" className="input" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--sp-3)' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 'var(--sp-1)' }}>
          本局胜者
        </legend>
        <div className="row">
          {[homeTeamId, awayTeamId].filter(Boolean).map((id) => (
            <button key={id} type="button" className="btn btn--small" aria-pressed={winnerId === id} onClick={() => setWinnerId(id)}>
              {nameOf(id)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="operator-field">
        <label htmlFor="bo3-kind">异常类型</label>
        <select id="bo3-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as ResultKind)}>
          {RESULT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="btn btn--primary"
        disabled={notNeeded || !homeTeamId || !awayTeamId || homeTeamId === awayTeamId}
        onClick={() =>
          onApply(
            applyBo3Game(draft, {
              seriesId: series.id,
              gameIndex: effectiveIndex,
              homeTeamId,
              awayTeamId,
              homeScore,
              awayScore,
              winnerId,
              resultKind: kind,
            }),
          )
        }
      >
        确认本局并写入草稿
      </button>
      {homeTeamId && awayTeamId && homeTeamId === awayTeamId ? (
        <div className="operator-errors" style={{ marginTop: 'var(--sp-2)' }}>
          双方不能是同一支队伍。
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 排位赛跑图成绩
 * ------------------------------------------------------------------ */

function QualRunsEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const [roundFilter, setRoundFilter] = useState<'all' | '1' | '2'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const progress = qualificationProgress(draft);

  const runs = useMemo(() => {
    return draft.qualification.runs
      .filter((r) => roundFilter === 'all' || String(r.round) === roundFilter)
      .sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round;
        const ia = draft.scheduleItems.find((s) => s.id === a.scheduleItemId);
        const ib = draft.scheduleItems.find((s) => s.id === b.scheduleItemId);
        return (ia?.plannedStart ?? '').localeCompare(ib?.plannedStart ?? '');
      });
  }, [draft, roundFilter]);

  const selected = selectedId ? draft.qualification.runs.find((r) => r.id === selectedId) ?? null : null;

  return (
    <div className="operator-grid">
      <div className="card">
        <div className="card__head">
          <span className="card__title">跑图进度</span>
        </div>
        <div className="operator-summary" style={{ marginBottom: 'var(--sp-3)' }}>
          <div>
            已确认 <strong>{progress.confirmed}</strong> / {progress.total}
          </div>
          <div className="xsmall muted">
            待确认 {progress.provisional} · 未录入 {progress.pending}
          </div>
        </div>

        <div className="segmented" role="group" aria-label="选择轮次" style={{ marginBottom: 'var(--sp-2)' }}>
          {(
            [
              ['all', '两轮'],
              ['1', '第一轮'],
              ['2', '第二轮'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="segmented__item"
              aria-pressed={roundFilter === key}
              onClick={() => setRoundFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginBottom: 'var(--sp-2)' }}>
          <button
            type="button"
            className="btn btn--small"
            disabled={progress.provisional === 0}
            onClick={() => onApply(confirmQualificationRuns(draft))}
          >
            全部确认（{progress.provisional}）
          </button>
        </div>

        <div className="operator-list">
          {runs.map((run) => {
            const team = draft.teams.find((t) => t.id === run.teamId);
            const item = draft.scheduleItems.find((s) => s.id === run.scheduleItemId);
            return (
              <button
                key={run.id}
                type="button"
                className="operator-item"
                aria-current={selectedId === run.id}
                onClick={() => setSelectedId(run.id)}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong className="small">
                    R{run.round} · {team?.name ?? run.teamId}
                  </strong>
                  <span className="xsmall muted tabular">
                    {item ? formatTime(item.plannedStart) : '—'}
                  </span>
                </div>
                <div className="row" style={{ gap: 'var(--sp-1)', marginTop: 2 }}>
                  <span className="xsmall muted">{draft.venues.find((v) => v.id === run.venueId)?.label ?? run.venueId}</span>
                  {run.resultStatus === 'confirmed' ? (
                    <span className="badge badge--advanced">已确认</span>
                  ) : run.resultStatus === 'provisional' ? (
                    <span className="badge badge--pending">待确认</span>
                  ) : (
                    <span className="badge badge--neutral">未录入</span>
                  )}
                  {run.rawResult || run.score ? (
                    <span className="xsmall">{run.rawResult ?? run.score}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {selected ? (
          <QualRunForm run={selected} draft={draft} onApply={onApply} />
        ) : (
          <div className="empty">从左侧选择一条跑图记录开始录入。</div>
        )}
      </div>
    </div>
  );
}

function QualRunForm({
  run,
  draft,
  onApply,
}: {
  run: EventFile['qualification']['runs'][number];
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const team = draft.teams.find((t) => t.id === run.teamId);
  const item = draft.scheduleItems.find((s) => s.id === run.scheduleItemId);

  const [rawResult, setRawResult] = useState(run.rawResult ?? '');
  const [score, setScore] = useState(run.score ?? '');
  const [elapsed, setElapsed] = useState(run.elapsedSeconds ?? '');
  const [judgeNote, setJudgeNote] = useState(run.judgeNote ?? '');

  const submit = (confirm: boolean) =>
    onApply(
      applyQualificationRun(draft, {
        runId: run.id,
        rawResult,
        score: score.trim() === '' ? null : score,
        elapsedSeconds: elapsed.trim() === '' ? null : elapsed,
        judgeNote: judgeNote.trim() === '' ? null : judgeNote.trim(),
        confirm,
      }),
    );

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">
          录入跑图成绩 · {team?.name ?? run.teamId}
        </span>
        <span className="badge badge--neutral">
          第 {run.round} 轮 · {draft.venues.find((v) => v.id === run.venueId)?.label ?? run.venueId}
        </span>
      </div>

      {item ? (
        <p className="xsmall muted">
          计划时间：{item.date} {formatTime(item.plannedStart)}
          {item.revisedStart ? `（已调整为 ${formatTime(item.revisedStart)}）` : ''}
        </p>
      ) : null}

      <div className="operator-field">
        <label htmlFor="q-raw">成绩文字</label>
        <input
          id="q-raw"
          className="input"
          value={rawResult}
          onChange={(e) => setRawResult(e.target.value)}
          placeholder="例如：2.35 米 / 完成 / 超时"
        />
        <span className="operator-field__hint">原文未规定成绩结构，因此允许自由文本。</span>
      </div>

      <div className="operator-inline" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="operator-field">
          <label htmlFor="q-score">积分（可选）</label>
          <input id="q-score" className="input" value={score} onChange={(e) => setScore(e.target.value)} inputMode="decimal" />
        </div>
        <div className="operator-field">
          <label htmlFor="q-elapsed">用时秒（可选）</label>
          <input id="q-elapsed" className="input" value={elapsed} onChange={(e) => setElapsed(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <div className="operator-field">
        <label htmlFor="q-note">裁判备注（可选）</label>
        <input id="q-note" className="input" value={judgeNote} onChange={(e) => setJudgeNote(e.target.value)} />
      </div>

      <div className="operator-warnings" style={{ marginBottom: 'var(--sp-3)' }}>
        <strong>重要：</strong>这两项只作记录，<strong>不参与自动排名</strong>。
        原文未规定「两轮最优」的比较与同分规则，因此正式名次请在
        「排位赛排名」页签人工录入裁判确认的 1–22 名。
      </div>

      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => submit(true)}>
          保存并确认
        </button>
        <button type="button" className="btn" onClick={() => submit(false)}>
          仅保存（待确认）
        </button>
        {run.resultStatus !== 'none' ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              onApply({ event: draft, ok: false, messages: [`当前状态：${run.resultStatus}，确认时间 ${run.confirmedAt ?? '—'}`] })
            }
          >
            查看状态
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 排位赛排名
 * ------------------------------------------------------------------ */

function QualificationEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const competitive = draft.teams.filter((t) => t.division === 'competitive');
  const existing = draft.qualification.ranking.orderedTeamIds;
  const [order, setOrder] = useState<string[]>(existing.length === competitive.length ? existing : []);
  const [sourceNote, setSourceNote] = useState(draft.qualification.ranking.sourceNote ?? '');

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    setOrder(next);
  };

  if (order.length === 0) {
    return (
      <div className="card">
        <div className="card__head">
          <span className="card__title">排位赛最终排名</span>
        </div>
        <p className="small muted">
          录入裁判确认的 1–22 名最终排序。排名必须包含全部 22 支竞技组队伍且不重复。
          不按积分、用时或三审排名自动排序。
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setOrder(competitive.map((t) => t.id))}
        >
          以当前顺序开始（三审顺序，需人工调整）
        </button>
      </div>
    );
  }

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">排位赛最终排名（{order.length} 队）</span>
        <button type="button" className="btn btn--small" onClick={() => setOrder([])}>
          重置
        </button>
      </div>

      <div className="operator-list" style={{ maxHeight: '50vh' }}>
        {order.map((teamId, i) => (
          <div key={teamId} className="row" style={{ justifyContent: 'space-between', padding: 'var(--sp-1) 0' }}>
            <span className="row" style={{ gap: 'var(--sp-2)' }}>
              <strong className="tabular small" style={{ width: '2em' }}>
                {i + 1}
              </strong>
              <span className="small">{draft.teams.find((t) => t.id === teamId)?.name ?? teamId}</span>
            </span>
            <span className="row" style={{ gap: 'var(--sp-1)' }}>
              <button type="button" className="btn btn--small" onClick={() => move(i, -1)} aria-label="上移">
                ↑
              </button>
              <button type="button" className="btn btn--small" onClick={() => move(i, 1)} aria-label="下移">
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="operator-field" style={{ marginTop: 'var(--sp-3)' }}>
        <label htmlFor="qual-source">来源说明</label>
        <input
          id="qual-source"
          className="input"
          value={sourceNote}
          onChange={(e) => setSourceNote(e.target.value)}
          placeholder="例如：裁判组核分表"
        />
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={() => onApply(applyQualificationRanking(draft, order, sourceNote.trim() === '' ? null : sourceNote.trim()))}
      >
        确认排名并写入草稿
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 轮次与配对
 * ------------------------------------------------------------------ */

function RoundsEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const [pending, setPending] = useState<{ roundIndex: number; result: PairingOutcome } | null>(null);

  const rounds = [...draft.swiss.rounds].sort((a, b) => a.index - b.index);

  return (
    <div className="stack">
      <div className="card">
        <div className="card__head">
          <span className="card__title">轮次状态</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>轮次</th>
                <th>状态</th>
                <th className="num">场次</th>
                <th>公布时间</th>
                <th>确认时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => {
                const matches = r.matchIds
                  .map((id) => draft.swiss.matches.find((m) => m.id === id))
                  .filter((m): m is SwissMatch => m !== undefined);
                const confirmed = matches.filter((m) =>
                  m.attempts.some((a) => a.id === m.effectiveAttemptId && a.resultStatus === 'confirmed'),
                ).length;
                return (
                  <tr key={r.id}>
                    <td className="tabular">R{r.index}</td>
                    <td>
                      <span className={`badge ${r.publicationStatus === 'published' ? 'badge--advanced' : 'badge--pending'}`}>
                        {r.publicationStatus === 'published' ? '已公布' : '未公布'}
                      </span>
                    </td>
                    <td className="num tabular">
                      {confirmed} / {matches.length}
                    </td>
                    <td className="xsmall">{r.publishedAt ? new Date(r.publishedAt).toLocaleString('zh-CN') : '—'}</td>
                    <td className="xsmall">{r.closedAt ? new Date(r.closedAt).toLocaleString('zh-CN') : '—'}</td>
                    <td>
                      <div className="row" style={{ gap: 'var(--sp-1)' }}>
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => {
                            const outcome = generateNextRound(draft, r.index);
                            setPending({ roundIndex: r.index, result: outcome });
                            onApply({ event: draft, ok: false, messages: outcome.messages.length > 0 ? outcome.messages : ['候选已生成（下方可公布）'] });
                          }}
                        >
                          生成候选
                        </button>
                        <button type="button" className="btn btn--small" onClick={() => onApply(confirmRound(draft, r.index))}>
                          确认整轮
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pending ? (
        <div className="card operator-draft">
          <div className="card__head">
            <span className="card__title">第 {pending.roundIndex} 轮候选对阵（未公布）</span>
            <span className="badge badge--pending">未发布</span>
          </div>

          {pending.result.proposal && pending.result.proposal.blockers.length > 0 ? (
            <div className="operator-errors" style={{ marginBottom: 'var(--sp-2)' }}>
              <strong>存在阻断问题，不能公布：</strong>
              <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
                {pending.result.proposal.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {pending.result.proposal && pending.result.proposal.pairs.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>组</th>
                      <th className="num">序号</th>
                      <th>对阵</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.result.proposal.pairs.map((p) => (
                      <tr key={`${p.groupRecord}-${p.orderInGroup}`}>
                        <td className="tabular">{p.groupRecord}</td>
                        <td className="num tabular">{p.orderInGroup}</td>
                        <td>
                          {draft.teams.find((t) => t.id === p.homeTeamId)?.name ?? p.homeTeamId} vs{' '}
                          {draft.teams.find((t) => t.id === p.awayTeamId)?.name ?? p.awayTeamId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
                第 3 轮全部 8 场会一次性公布，跨日期间保持固定；请确认后再公布。
              </p>
              <button
                type="button"
                className="btn btn--primary"
                disabled={pending.result.proposal.blockers.length > 0}
                onClick={() => onApply(publishRound(draft, pending.roundIndex, pending.result.proposal!))}
              >
                公布这 {pending.result.proposal.pairs.length} 场对阵并冻结
              </button>
            </>
          ) : (
            <div className="empty">没有生成任何候选对阵。</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 八强种子
 * ------------------------------------------------------------------ */

function SeedsEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const seeding = draft.finals.seeding;

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">八强种子</span>
        {seeding ? <span className="badge badge--advanced">版本 {seeding.version} 已公布</span> : <span className="badge badge--pending">未公布</span>}
      </div>

      <p className="small muted">
        种子必须等第五轮全部结束并确认后统一计算：3-0 前两名为 W1/W2；3-1 前两名为 W3/W4、第三名为 L1；
        3-2 三名为 L2–L4。计算使用第五轮结算后的完整数据。
      </p>

      {seeding ? (
        <div className="table-wrap" style={{ marginBottom: 'var(--sp-3)' }}>
          <table className="table">
            <thead>
              <tr>
                <th>种子</th>
                <th>队伍</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(seeding.seeds).map(([seed, teamId]) => (
                <tr key={seed}>
                  <td className="tabular">{seed}</td>
                  <td>{draft.teams.find((t) => t.id === teamId)?.name ?? teamId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <button type="button" className="btn btn--primary" onClick={() => onApply(publishFinalsSeeding(draft))}>
        {seeding ? '重新计算并公布种子' : '计算并公布八强种子'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 展示组抽签
 * ------------------------------------------------------------------ */

function ShowcaseEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const showcase = draft.teams.filter((t) => t.division === 'showcase');
  const [order, setOrder] = useState<string[]>(
    draft.showcase.drawOrder && draft.showcase.drawOrder.length === showcase.length
      ? draft.showcase.drawOrder
      : showcase.map((t) => t.id),
  );

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[target] = a;
    setOrder(next);
  };

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">展示组抽签顺序</span>
        {draft.showcase.drawOrder ? <span className="badge badge--advanced">已登记</span> : <span className="badge badge--pending">未登记</span>}
      </div>

      <p className="small muted">
        10 月 3 日 12:00 抽签决定决赛上台次序。抽签前页面不会推测演出顺序。
        请按抽签结果从上到下排列（第 1 位最先上台）。
      </p>

      <div className="stack stack--tight" style={{ marginBottom: 'var(--sp-3)' }}>
        {order.map((teamId, i) => (
          <div key={teamId} className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 'var(--sp-2)' }}>
              <strong className="tabular small" style={{ width: '3.5em' }}>
                第 {i + 1} 队
              </strong>
              <span className="small">{draft.teams.find((t) => t.id === teamId)?.name ?? teamId}</span>
            </span>
            <span className="row" style={{ gap: 'var(--sp-1)' }}>
              <button type="button" className="btn btn--small" onClick={() => move(i, -1)} aria-label="上移">
                ↑
              </button>
              <button type="button" className="btn btn--small" onClick={() => move(i, 1)} aria-label="下移">
                ↓
              </button>
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn--primary" onClick={() => onApply(applyShowcaseDraw(draft, order))}>
        登记抽签顺序
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 公告与时间
 * ------------------------------------------------------------------ */

function NoticesEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: { event: EventFile; ok: boolean; messages: string[] }) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');

  const [scheduleId, setScheduleId] = useState('');
  const [revisedStart, setRevisedStart] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');

  return (
    <div className="stack">
      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">添加公告</span>
        </div>
        <div className="operator-field">
          <label htmlFor="n-title">标题</label>
          <input id="n-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="operator-field">
          <label htmlFor="n-body">内容</label>
          <textarea id="n-body" className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} style={{ paddingTop: 8, minHeight: 80 }} />
        </div>
        <div className="operator-field">
          <label htmlFor="n-sev">级别</label>
          <select id="n-sev" className="select" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
            <option value="info">信息</option>
            <option value="warning">注意</option>
            <option value="critical">重要</option>
          </select>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => onApply(addNotice(draft, title, body, severity))}>
          添加公告
        </button>
      </div>

      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">调整时间</span>
        </div>
        <div className="operator-field">
          <label htmlFor="s-id">日程项</label>
          <select id="s-id" className="select" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">（选择）</option>
            {draft.scheduleItems.slice(0, 300).map((s) => (
              <option key={s.id} value={s.id}>
                {s.date} {formatTime(s.plannedStart)} · {s.title.slice(0, 30)}
              </option>
            ))}
          </select>
        </div>
        <div className="operator-field">
          <label htmlFor="s-start">修订后开始时间（带偏移的 ISO 8601）</label>
          <input
            id="s-start"
            className="input"
            value={revisedStart}
            onChange={(e) => setRevisedStart(e.target.value)}
            placeholder="2026-10-03T09:10:00+08:00"
          />
          <span className="operator-field__hint">原计划时间保持不变，修订时间单独记录。</span>
        </div>
        <div className="operator-field">
          <label htmlFor="s-note">调整说明</label>
          <input id="s-note" className="input" value={adjustmentNote} onChange={(e) => setAdjustmentNote(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!scheduleId}
          onClick={() =>
            onApply(
              adjustSchedule(draft, scheduleId, revisedStart.trim() === '' ? null : revisedStart.trim(), adjustmentNote.trim() === '' ? null : adjustmentNote.trim()),
            )
          }
        >
          保存调整
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 导出与发布
 * ------------------------------------------------------------------ */

function ExportPanel({
  draft,
  baseRevision,
  check,
}: {
  draft: EventFile;
  baseRevision: string;
  check: { ok: boolean; errors: string[]; warnings: string[] } | null;
}) {
  const [exported, setExported] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const doExport = () => {
    const pkg = buildChangePackage(draft, baseRevision);
    const text = JSON.stringify(pkg, null, 2);
    setExported(text);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const a = document.createElement('a');
      a.href = url;
      a.download = `rg26-change-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
    } catch {
      // 下载失败时用户仍可复制下方文本
    }
  };

  return (
    <div className="stack">
      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">发布前检查</span>
          {check?.ok ? <span className="badge badge--advanced">通过</span> : <span className="badge badge--danger">未通过</span>}
        </div>
        {check && !check.ok ? (
          <div className="operator-errors">
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {check.errors.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="operator-ok">草稿结构完整，可以导出。</div>
        )}
        {check && check.warnings.length > 0 ? (
          <details className="disclosure" style={{ marginTop: 'var(--sp-2)' }}>
            <summary>{check.warnings.length} 条提示</summary>
            <ul style={{ paddingLeft: '1.2em' }}>
              {check.warnings.slice(0, 20).map((w) => (
                <li key={w} className="xsmall">
                  {w}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">导出变更包</span>
        </div>
        <div className="operator-summary" style={{ marginBottom: 'var(--sp-3)' }}>
          <div>
            基础版本（baseRevision）：<code>{baseRevision}</code>
          </div>
          <div className="xsmall muted">
            导入时会核对这个版本。如果它与仓库中的最新版本不一致，导入会被拒绝，需要人工合并。
          </div>
        </div>
        <button type="button" className="btn btn--primary" onClick={doExport} disabled={!check?.ok}>
          下载变更包 JSON
        </button>
        {exported ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <label className="small" htmlFor="export-text">
              或复制下方文本：
            </label>
            <textarea
              id="export-text"
              className="input"
              readOnly
              rows={6}
              value={exported}
              onFocus={(e) => e.currentTarget.select()}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 120, paddingTop: 8 }}
            />
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">接下来的发布步骤</span>
        </div>
        <ol className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>
            保存变更包后，在终端运行：
            <br />
            <code>npm run data:import -- --file &lt;导出文件路径&gt;</code>
          </li>
          <li>
            运行 <code>npm run validate:data</code> 复核。
          </li>
          <li>
            运行 <code>npm run data:build</code> 生成公开快照并本地预览。
          </li>
          <li>提交 data/event.json，提交信息说明轮次或更正原因，推送到发布分支。</li>
          <li>等待 Actions 部署成功，在公开页面核对 revision 与结果。</li>
        </ol>
        <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
          注意：导入完成、commit 成功、push 成功都不等于观众已经看到更新。
        </p>
      </div>
    </div>
  );
}

export { generateSwissPairings };
