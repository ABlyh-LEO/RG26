/**
 * 第 N 轮对阵：预览、人工微调、公布。
 *
 * 为什么需要人工微调：手册规定的是"应该怎么配对"，但现场会出现手册没写的情况
 * （设备故障、同校回避、场地冲突……）。组委会的实际决定必须能落到数据里，
 * 否则维护者只能在页面之外口头说明。
 *
 * 三条硬约束（都不许绕过）：
 * 1. 只有**轮次门禁**通过（上一轮已结束、排位赛名次已成立）才能公布；
 * 2. 微调后的对阵必须是**结构完整**的：场次数与手册一致、每队恰好出场一次、
 *    无自我对阵、无重复对阵 —— 由 `checkPairingAdjustment` 判定；
 * 3. 与自动配对不同就必须**写明原因**，随轮次一起写入 `revisionNote`。
 *
 * 微调只改"谁对谁"，不移动场次、时间与场地：换对手不该把比赛挪到别的时间。
 */
import { useState } from 'react';
import type { EventFile } from '../domain/schema';
import { matchNumbersFor } from '../domain/match-numbers';
import {
  checkPairingAdjustment,
  swapPairingSlots,
  type PairingPair,
  type PairingProposal,
  type PairingSide,
  type PairingSlotRef,
} from '../domain/swiss';
import { sideLabel, sidesForSwiss } from '../domain/sides';
import { publishRound, publishedRoundPairs, type ApplyResult } from './draft';

interface Props {
  draft: EventFile;
  roundIndex: number;
  proposal: PairingProposal;
  onApply: (result: ApplyResult) => void;
}

const slug = (side: PairingSide): string => (side === 'home' ? '1' : '2');

export function RoundPairingPanel({ draft, roundIndex, proposal, onApply }: Props) {
  const live = draft.swiss.rounds.find((round) => round.index === roundIndex);
  const current = publishedRoundPairs(draft, roundIndex);

  const [pairs, setPairs] = useState<PairingPair[]>(() => current?.pairs ?? proposal.pairs);
  const [note, setNote] = useState(current?.note ?? '');
  const [selected, setSelected] = useState<PairingSlotRef | null>(null);

  const nameOf = (teamId: string): string =>
    draft.teams.find((team) => team.id === teamId)?.name ?? teamId;
  const recordOf = (teamId: string): string | null =>
    proposal.standings.byTeam.get(teamId)?.record ?? null;

  const numbers = matchNumbersFor(draft);
  const matchIds = live?.matchIds ?? [];
  const noLabelOf = (index: number): string => {
    const no = numbers.byId.get(matchIds[index] ?? '');
    return no === undefined ? `本组第 ${pairs[index]?.orderInGroup ?? index + 1} 场` : `第 ${no} 场`;
  };

  const check = checkPairingAdjustment(proposal, pairs, { label: nameOf, slotLabel: noLabelOf });
  const changed = check.changedMatchCount > 0;
  const sides = sidesForSwiss(roundIndex);
  const sideOfSlot = (side: PairingSide) => (side === 'home' ? sides.first : sides.second);

  const pick = (ref: PairingSlotRef) => {
    if (!selected) {
      setSelected(ref);
      return;
    }
    if (selected.matchIndex === ref.matchIndex && selected.side === ref.side) {
      setSelected(null);
      return;
    }
    setPairs(swapPairingSlots(pairs, selected, ref));
    setSelected(null);
  };

  const blocked = proposal.blockers.length > 0;
  const hasError = blocked || check.errors.length > 0;
  const needsNote = changed && note.trim() === '';
  // 未做任何调整时，自动配对本身的构成问题仍然不允许原样公布。
  const rawProblem = !changed && proposal.compositionIssues.length > 0;

  return (
    <div className="card operator-draft">
      <div className="card__head">
        <span className="card__title">第 {roundIndex} 轮对阵（可人工微调）</span>
        <span className={`badge ${live?.publicationStatus === 'published' ? 'badge--advanced' : 'badge--pending'}`}>
          {live?.publicationStatus === 'published'
            ? `已公布 · 第 ${live.pairingVersion} 版${current ? '' : '（参赛双方不完整）'}`
            : '未公布'}
        </span>
      </div>

      {blocked ? (
        <div className="operator-errors" style={{ marginBottom: 'var(--sp-2)' }}>
          <strong>轮次门禁未通过，现在不能公布本轮（人工微调也不能绕过）：</strong>
          <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
            {proposal.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!blocked && proposal.compositionIssues.length > 0 ? (
        <div className="operator-errors" style={{ marginBottom: 'var(--sp-2)' }}>
          <strong>自动配对存在需要人工处理的问题，原样公布会被拒绝：</strong>
          <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
            {proposal.compositionIssues.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="xsmall" style={{ margin: 'var(--sp-2) 0 0' }}>
            如组委会已决定调整，请在下方直接改对阵并写明原因；轮空、增减场次不在本页处理范围。
          </p>
        </div>
      ) : null}

      {pairs.length === 0 ? (
        <div className="empty">没有可公布的对阵。</div>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            点击两支队伍即交换它们的位置：不同场之间交换 = 换对手，同一场两个席位交换 = 换边（红蓝互换）。
            微调<b>不改变</b>场次顺序、比赛编号、时间与场地。
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">编号</th>
                  <th>战绩组</th>
                  <th>对阵（点击可交换）</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair, index) => (
                  <tr key={`${pair.groupRecord}-${pair.orderInGroup}`}>
                    <td className="num tabular" title={`${pair.groupRecord} 组第 ${pair.orderInGroup} 场`}>
                      {noLabelOf(index)}
                    </td>
                    <td className="tabular">
                      {pair.groupRecord}
                      {recordOf(pair.homeTeamId) !== pair.groupRecord ||
                      recordOf(pair.awayTeamId) !== pair.groupRecord ? (
                        <span className="badge badge--pending" style={{ marginLeft: 4 }} title="跨组调整">
                          跨组
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <div className="operator-inline" style={{ alignItems: 'center', gap: 'var(--sp-1)' }}>
                        {(['home', 'away'] as const).map((side, position) => {
                          const teamId = side === 'home' ? pair.homeTeamId : pair.awayTeamId;
                          const active = selected?.matchIndex === index && selected.side === side;
                          return (
                            <span key={side} className="row" style={{ gap: 'var(--sp-1)', alignItems: 'center' }}>
                              {position === 1 ? <span className="xsmall muted">对</span> : null}
                              <button
                                type="button"
                                className="btn btn--small pairing-chip"
                                data-testid={`pair-slot-${index}-${slug(side)}`}
                                aria-pressed={active}
                                aria-label={`${noLabelOf(index)}${sideLabel(sideOfSlot(side))}：${nameOf(teamId)}`}
                                onClick={() => pick({ matchIndex: index, side })}
                              >
                                <span className="pairing-chip__side">{sideLabel(sideOfSlot(side))}</span>
                                <span className="pairing-chip__name">{nameOf(teamId)}</span>
                                <span className="pairing-chip__record tabular">{recordOf(teamId) ?? '—'}</span>
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setPairs(swapPairingSlots(pairs, { matchIndex: index, side: 'home' }, { matchIndex: index, side: 'away' }))}
                      >
                        换边
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {check.errors.length > 0 ? (
            <div className="operator-errors" style={{ marginTop: 'var(--sp-2)' }}>
              <strong>当前对阵还不能公布：</strong>
              <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
                {check.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {check.warnings.length > 0 ? (
            <div className="operator-warnings" style={{ marginTop: 'var(--sp-2)' }}>
              {check.warnings.map((item) => (
                <p key={item} style={{ margin: 0 }}>{item}</p>
              ))}
            </div>
          ) : null}

          {changed ? (
            <div className="operator-ok" style={{ marginTop: 'var(--sp-2)' }}>
              <strong>与自动配对相比已调整 {check.changedMatchCount} 场：</strong>
              <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
                {check.changes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
              当前与自动配对完全一致（{pairs.length} 场）。
            </p>
          )}

          <div className="operator-field" style={{ marginTop: 'var(--sp-3)' }}>
            <label htmlFor={`pairing-note-${roundIndex}`}>
              调整说明{changed ? '（已调整，必填）' : '（未调整，可留空）'}
            </label>
            <input
              id={`pairing-note-${roundIndex}`}
              className="input"
              value={note}
              aria-invalid={needsNote}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：某队机器人故障，经裁判组同意与另一场交换对手"
            />
            <span className="operator-field__hint">
              这条说明会随本轮一起写入数据，观众端显示为「组委会修订：…」；未调整时会清空。
            </span>
          </div>

          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={hasError || rawProblem || needsNote}
              onClick={() =>
                onApply(
                  publishRound(draft, roundIndex, proposal, changed ? { pairs, note } : null),
                )
              }
            >
              {live?.publicationStatus === 'published'
                ? `重新公布这 ${pairs.length} 场对阵`
                : `公布这 ${pairs.length} 场对阵并冻结`}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!changed && selected === null}
              onClick={() => {
                setPairs(proposal.pairs);
                setSelected(null);
              }}
            >
              恢复自动配对
            </button>
            {current ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPairs(current.pairs);
                  setNote(current.note ?? '');
                  setSelected(null);
                }}
              >
                载入当前已公布对阵
              </button>
            ) : null}
          </div>

          {needsNote ? (
            <p className="xsmall" style={{ marginTop: 'var(--sp-2)', color: 'var(--danger)' }}>
              已改动对阵，请先填写调整说明。
            </p>
          ) : null}
          {!changed && proposal.compositionIssues.length > 0 ? (
            <p className="xsmall" style={{ marginTop: 'var(--sp-2)', color: 'var(--danger)' }}>
              自动配对本身有问题，请先按要求微调后再公布。
            </p>
          ) : null}
          {live?.revisionNote ? (
            <p className="xsmall muted" style={{ marginTop: 'var(--sp-2)' }}>
              已公布版本的调整说明：{live.revisionNote}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
