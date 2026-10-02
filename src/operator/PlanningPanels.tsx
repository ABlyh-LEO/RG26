import { useMemo, useState } from 'react';
import type { EventFile, SwissMatch } from '../domain/schema';
import { formatTime } from '../data/view-model';
import { computeQualificationRanking } from '../domain/qualification-ranking';
import { useFormField } from './FormDraftContext';
import { addNotice, adjustSchedule, applyQualificationAutoRanking, applyQualificationRanking,
  applyShowcaseDraw, confirmRound, generateNextRound, publishFinalsSeeding, publishRound,
  type ApplyResult, type PairingOutcome } from './draft';

type PanelResult = ApplyResult & { clearFormKeys?: string[] };

export function QualificationEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: PanelResult) => void;
}) {
  const competitive = draft.teams.filter((t) => t.division === 'competitive');
  const existing = draft.qualification.ranking.orderedTeamIds;
  const [order, setOrder] = useFormField<string[]>('planning.qualification', 'order', existing.length === competitive.length ? existing : []);
  const [sourceNote, setSourceNote] = useFormField('planning.qualification', 'sourceNote', draft.qualification.ranking.sourceNote ?? '');

  /** 由成绩实时推算的名次（口径：积分高者优，同分时用时短者优）。 */
  const computed = useMemo(() => computeQualificationRanking(draft), [draft]);
  const bestOf = (teamId: string) => computed.standings.find((s) => s.teamId === teamId)?.best ?? null;

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
    <div className="stack">
      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">按成绩自动推算的名次</span>
          <span className="badge badge--info">积分高者优 · 同分时用时短者优</span>
        </div>

        <p className="small muted" style={{ marginTop: 0 }}>
          这是由已确认成绩实时算出的名次。单场成绩更新后会自动重排，无需手动拉顺序。
        </p>

        {computed.incompleteTeamIds.length > 0 ? (
          <div className="operator-errors" style={{ marginBottom: 'var(--sp-2)' }}>
            <strong>{computed.incompleteTeamIds.length} 支队伍暂无积分成绩，已排在榜尾：</strong>
            <div className="xsmall" style={{ marginTop: 4 }}>
              {computed.incompleteTeamIds
                .map((id) => draft.teams.find((t) => t.id === id)?.name ?? id)
                .join('、')}
            </div>
          </div>
        ) : null}
        {computed.tiedTeamIds.length > 0 ? (
          <div className="operator-warnings" style={{ marginBottom: 'var(--sp-2)' }}>
            积分与用时完全相同的并列，名次无法由数据区分，请人工复核：
            {computed.tiedTeamIds
              .map((id) => draft.teams.find((t) => t.id === id)?.name ?? id)
              .join('、')}
          </div>
        ) : null}

        <div className="table-wrap" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th className="num">名次</th>
                <th>队伍</th>
                <th className="num">最优积分</th>
                <th className="num">用时(秒)</th>
                <th>取自</th>
                <th>成绩</th>
              </tr>
            </thead>
            <tbody>
              {computed.standings.map((s) => (
                <tr key={s.teamId}>
                  <td className="num tabular">{s.rank}</td>
                  <td>
                    {draft.teams.find((t) => t.id === s.teamId)?.name ?? s.teamId}
                    {s.tiedWithPrevious ? <span className="badge badge--pending" style={{ marginLeft: 6 }}>并列</span> : null}
                  </td>
                  <td className="num tabular">{s.best?.score ?? '—'}</td>
                  <td className="num tabular">{s.best?.elapsedSeconds ?? '—'}</td>
                  <td className="xsmall">第 {s.best?.round ?? '—'} 轮</td>
                  <td className="xsmall">{s.best?.label ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 'var(--sp-3)' }}
          onClick={() => onApply(applyQualificationAutoRanking(draft))}
        >
          采用这个名次并写入草稿
        </button>
      </div>

      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">人工覆盖（可选）</span>
          {order.length > 0 ? <span className="badge badge--pending">已启用</span> : null}
        </div>
        <p className="xsmall muted" style={{ marginTop: 0 }}>
          仅当自动名次无法表达组委会决定时使用（例如并列需指定先后）。
          排名必须包含全部 {competitive.length} 支竞技组队伍且不重复。
        </p>

        {order.length === 0 ? (
          <button
            type="button"
            className="btn"
            onClick={() => setOrder(computed.standings.map((s) => s.teamId))}
          >
            以自动名次为起点，手动微调
          </button>
        ) : (
          <>
            <div className="operator-list" style={{ maxHeight: '50vh' }}>
              {order.map((teamId, i) => (
                <div key={teamId} className="row" style={{ justifyContent: 'space-between', padding: 'var(--sp-1) 0' }}>
                  <span className="row" style={{ gap: 'var(--sp-2)' }}>
                    <strong className="tabular small" style={{ width: '2em' }}>
                      {i + 1}
                    </strong>
                    <span className="small">{draft.teams.find((t) => t.id === teamId)?.name ?? teamId}</span>
                    <span className="xsmall muted">
                      {bestOf(teamId)?.score ?? '—'} 分 / {bestOf(teamId)?.elapsedSeconds ?? '—'} 秒
                    </span>
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

            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() =>
                  onApply({ ...applyQualificationRanking(draft, order, sourceNote.trim() === '' ? null : sourceNote.trim()), clearFormKeys: ['planning.qualification'] })
                }
              >
                确认人工名次并写入草稿
              </button>
              <button type="button" className="btn" onClick={() => setOrder([])}>
                取消人工覆盖
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 轮次与配对
 * ------------------------------------------------------------------ */

export function RoundsEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: PanelResult) => void;
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
                第 3 轮全部 8 场于 10 月 3 日晚间进行，对阵一次性公布；请确认后再公布。
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

export function SeedsEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: PanelResult) => void;
}) {
  const seeding = draft.finals.seeding;

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">八强种子</span>
        {seeding ? <span className="badge badge--advanced">版本 {seeding.version} 已公布</span> : <span className="badge badge--pending">未公布</span>}
      </div>

      <p className="small muted">
        种子必须等第五轮全部结束并确认后统一计算，使用第五轮结算后的完整数据。
        上午首轮按已公布种子对阵，下午按胜负进入对应分组。
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
              {Object.entries(seeding.seeds).map(([seed, teamId], index) => (
                <tr key={seed}>
                  <td className="tabular">第 {index + 1} 名</td>
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

export function ShowcaseEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: PanelResult) => void;
}) {
  const showcase = draft.teams.filter((t) => t.division === 'showcase');
  const [order, setOrder] = useFormField<string[]>('planning.showcase', 'order',
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

      <button type="button" className="btn btn--primary" onClick={() => onApply({ ...applyShowcaseDraw(draft, order), clearFormKeys: ['planning.showcase'] })}>
        登记抽签顺序
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 公告与时间
 * ------------------------------------------------------------------ */

export function NoticesEntry({
  draft,
  onApply,
}: {
  draft: EventFile;
  onApply: (r: PanelResult) => void;
}) {
  const [title, setTitle] = useFormField('notices', 'title', '');
  const [body, setBody] = useFormField('notices', 'body', '');
  const [severity, setSeverity] = useFormField<'info' | 'warning' | 'critical'>('notices', 'severity', 'info');

  const [scheduleId, setScheduleId] = useFormField('schedule', 'id', '');
  const [revisedStart, setRevisedStart] = useFormField(`schedule.${scheduleId}`, 'start', '');
  const [adjustmentNote, setAdjustmentNote] = useFormField(`schedule.${scheduleId}`, 'note', '');

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
        <button type="button" className="btn btn--primary" onClick={() => onApply({ ...addNotice(draft, title, body, severity), clearFormKeys: ['notices'] })}>
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
                {s.date} {formatTime(s.revisedStart ?? s.plannedStart)} · {s.title.slice(0, 30)}
              </option>
            ))}
          </select>
        </div>
        <div className="operator-field">
          <label htmlFor="s-start">修订后开始时间（北京时间）</label>
          <input
            id="s-start"
            type="datetime-local"
            className="input"
            value={revisedStart}
            onChange={(e) => setRevisedStart(e.target.value)}
            aria-describedby="s-start-hint"
          />
          <span id="s-start-hint" className="operator-field__hint">原计划时间保持不变。清空可取消修订时间，调整原因会保留。</span>
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
              { ...adjustSchedule(draft, scheduleId, revisedStart.trim() === '' ? null : `${revisedStart.trim()}:00+08:00`, adjustmentNote.trim() === '' ? null : adjustmentNote.trim()), clearFormKeys: ['schedule', `schedule.${scheduleId}`] },
            )
          }
        >
          保存调整
        </button>
      </div>
    </div>
  );
}
