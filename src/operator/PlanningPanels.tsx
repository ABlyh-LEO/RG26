import { useMemo, useState } from 'react';
import type { EventFile, SwissMatch } from '../domain/schema';
import { formatTime } from '../data/view-model';
import { computeQualificationRanking } from '../domain/qualification-ranking';
import { assessQualificationCompleteness } from '../domain/qualification-completeness';
import { useFormField } from './FormDraftContext';
import { RoundPairingPanel } from './PairingPanel';
import { addNotice, adjustSchedule, applyQualificationRanking, confirmQualificationRanking,
  applyShowcaseDraw, confirmRound, generateNextRound, publishFinalsSeeding,
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
  /** 定榜门禁：每支竞技组队伍都要有已确认的积分成绩。 */
  const completeness = useMemo(() => assessQualificationCompleteness(draft), [draft]);
  const [reviewNote, setReviewNote] = useFormField('planning.qualification', 'reviewNote', '');
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
          这是由已确认成绩实时算出的<b>当前排行</b>。它在成绩收齐并定榜之前<b>不是正式名次</b>，
          观众端只会看到「当前排行」标注，不会据此断言任何队伍晋级。
        </p>

        {!completeness.ok ? (
          <div className="operator-errors" style={{ marginBottom: 'var(--sp-2)' }}>
            <strong>成绩不完整，暂不能定榜：</strong>
            <div className="xsmall" style={{ marginTop: 4 }}>{completeness.reason}</div>
            <div className="xsmall" style={{ marginTop: 4 }}>
              名单：{completeness.missingTeamIds.map((id) => draft.teams.find((t) => t.id === id)?.name ?? id).join('、')}
            </div>
          </div>
        ) : (
          <div className="operator-warnings" style={{ marginBottom: 'var(--sp-2)' }}>
            成绩已完整（{completeness.scoredTeamIds.length} / {completeness.teamCount} 支队伍有可比成绩），可以定榜。
          </div>
        )}
        {completeness.partialTeamIds.length > 0 ? (
          <div className="operator-warnings" style={{ marginBottom: 'var(--sp-2)' }}>
            {completeness.partialTeamIds.length} 支队伍只录到一轮成绩：
            {completeness.partialTeamIds.map((id) => draft.teams.find((t) => t.id === id)?.name ?? id).join('、')}
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

        {completeness.partialTeamIds.length > 0 || completeness.tiedTeamIds.length > 0 ? (
          <div className="operator-field" style={{ marginTop: 'var(--sp-2)' }}>
            <label htmlFor="qual-review">复核说明{completeness.tiedTeamIds.length > 0 ? '（并列必填）' : '（建议填写）'}</label>
            <input
              id="qual-review"
              className="input"
              value={reviewNote}
              aria-invalid={completeness.tiedTeamIds.length > 0 && reviewNote.trim() === ''}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="例如：只录到一轮的队伍已电话确认；并列按第 1 轮成绩区分，裁判组已签字"
            />
            <p className="xsmall muted" style={{ marginTop: 4 }}>
              这条说明会随名次一起写入数据，事后可以追问"当时是谁、按什么依据核对的"。
            </p>
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 'var(--sp-3)' }}
          disabled={!completeness.ok || (completeness.tiedTeamIds.length > 0 && reviewNote.trim() === '')}
          onClick={() => onApply(confirmQualificationRanking(draft, { reviewNote }))}
        >
          核对无误，定榜并写入草稿
        </button>
        <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
          定榜后名次成为<b>正式名次</b>，观众端才会显示「晋级十六强 / 优秀奖」。
          成绩不完整时按钮不可用；确需在成绩不全时定榜，请走下方「人工覆盖」并填写来源说明。
        </p>
        {draft.qualification.ranking.status === 'confirmed' ? (
          <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
            本名次已于 {draft.qualification.ranking.confirmedAt?.slice(0, 16).replace('T', ' ') ?? '（时间缺失）'} 定榜
            {draft.qualification.ranking.reviewNote ? `；复核说明：${draft.qualification.ranking.reviewNote}` : '；未填写复核说明'}
            {draft.qualification.ranking.overrideReason ? `；豁免原因：${draft.qualification.ranking.overrideReason}` : ''}。
          </p>
        ) : null}
      </div>

      <div className="card operator-draft">
        <div className="card__head">
          <span className="card__title">人工覆盖（可选）</span>
          {order.length > 0 ? <span className="badge badge--pending">已启用</span> : null}
        </div>
        <p className="xsmall muted" style={{ marginTop: 0 }}>
          仅当自动名次无法表达组委会决定时使用（例如并列需指定先后，或裁判组直接核分）。
          排名必须包含全部 {competitive.length} 支竞技组队伍且不重复。
          <b>成绩不完整时，「来源说明」必填</b>——不完整的名次只能由人负责，不能看起来像是算出来的。
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

      {pending?.result.proposal ? (
        <RoundPairingPanel
          key={`${pending.roundIndex}:${pending.result.proposal.pairs
            .map((pair) => `${pair.homeTeamId}-${pair.awayTeamId}`)
            .join(',')}`}
          draft={draft}
          roundIndex={pending.roundIndex}
          proposal={pending.result.proposal}
          onApply={onApply}
        />
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
