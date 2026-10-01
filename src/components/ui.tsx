/**
 * 共享展示组件：队伍名、比分、状态徽章、空态、关注按钮等。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Team } from '../domain/schema';
import type { Side } from '../domain/sides';
import type { MatchView } from '../data/view-model';

/* ------------------------------------------------------------------ *
 * 红蓝方
 * ------------------------------------------------------------------ */

/**
 * 红/蓝方徽章。
 *
 * 红蓝方由赛程结构自动推出（`domain/sides.ts`），不落库，
 * 因此这里只负责展示，不做任何推断。
 */
export function SideBadge({ side }: { side: Side }) {
  const isRed = side === 'red';
  return (
    <span
      className={`badge ${isRed ? 'badge--danger' : 'badge--info'} side-badge`}
      title={isRed ? '红方' : '蓝方'}
      aria-label={isRed ? '红方' : '蓝方'}
    >
      {isRed ? '红' : '蓝'}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * 队伍名
 * ------------------------------------------------------------------ */

export function TeamName({
  team,
  fallback,
  className = '',
  linkTo = true,
}: {
  team: Team | null;
  fallback: string;
  className?: string;
  linkTo?: boolean;
}) {
  if (!team) {
    return (
      <span className={`team-name muted ${className}`} title={fallback}>
        {fallback}
      </span>
    );
  }
  const long = team.name.length > 8;
  const content = (
    <span className={`team-name${long ? ' team-name--long' : ''} ${className}`} title={team.name}>
      {team.name}
    </span>
  );
  if (!linkTo) return content;
  return (
    <Link to={`/teams/${team.id}`} style={{ color: 'inherit' }}>
      {content}
    </Link>
  );
}

/** 队伍编号徽标。 */
export function TeamNumberBadge({ team }: { team: Team }) {
  return (
    <span className="team-number" aria-label={`队伍编号 ${team.number}`}>
      #{team.number}
    </span>
  );
}

/** 队名待核对提示。 */
export function NameReviewBadge({ team }: { team: Team }) {
  if (team.nameVerified) return null;
  return (
    <span className="badge badge--pending" title={team.nameNote ?? '队名待核对'}>
      队名待核对
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * 状态徽章
 * ------------------------------------------------------------------ */

export function StatusBadge({ status }: { status: MatchView['executionStatus'] }) {
  const map: Record<MatchView['executionStatus'], { label: string; cls: string }> = {
    scheduled: { label: '未开始', cls: 'badge--neutral' },
    ready: { label: '准备中', cls: 'badge--info' },
    running: { label: '进行中', cls: 'badge--info' },
    finished: { label: '已结束', cls: 'badge--neutral' },
    delayed: { label: '延迟', cls: 'badge--pending' },
    cancelled: { label: '已取消', cls: 'badge--danger' },
    'not-needed': { label: '不需要进行', cls: 'badge--neutral' },
  };
  const item = map[status];
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

export function ResultBadge({ status }: { status: MatchView['resultStatus'] }) {
  if (status === 'confirmed') return <span className="badge badge--advanced">已确认</span>;
  if (status === 'provisional') return <span className="badge badge--pending">待确认成绩</span>;
  return null;
}

export function PublicationBadge({ status }: { status: 'draft' | 'published' | 'superseded' }) {
  if (status === 'published') return <span className="badge badge--advanced">已公布</span>;
  if (status === 'superseded') return <span className="badge badge--danger">已作废</span>;
  return <span className="badge badge--pending">未公布</span>;
}

/* ------------------------------------------------------------------ *
 * 空态
 * ------------------------------------------------------------------ */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 比赛卡（通用）
 * ------------------------------------------------------------------ */

export function MatchCard({ match, showStage = false }: { match: MatchView; showStage?: boolean }) {
  const schedule = match.schedule;
  const time = schedule ? schedule.plannedStart : null;
  const [home, away] = match.sides ?? [null, null];
  const isRun = match.kind === 'run';

  /**
   * 本场红蓝方。
   *
   * 由赛程结构自动推出（`domain/sides.ts`）：默认第一席位蓝、第二红；
   * 瑞士轮偶数轮反向；八强双败不反向；BO3 每局另见比赛详情页。
   * 对阵未确定时 `sides` 为 null，此时**不显示**任何颜色。
   */
  const sides = match.sidesInfo;

  return (
    <div className="card" style={{ padding: 'var(--sp-3)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          {time ? (
            <strong className="tabular" style={{ fontSize: 'var(--text-sm)' }}>
              {new Date(time).toLocaleTimeString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </strong>
          ) : (
            <span className="muted xsmall">时间待定</span>
          )}
          {match.venueLabel ? <span className="muted xsmall">{match.venueLabel}</span> : null}
          {match.format ? <span className="badge badge--neutral">{match.format}</span> : null}
          {isRun ? <span className="badge badge--neutral">单队跑图</span> : null}
          {showStage ? (
            <span className="badge badge--neutral">
              {match.stage === 'swiss'
                ? `R${match.roundIndex}`
                : match.stage === 'qualification'
                  ? `排位 R${match.roundIndex}`
                  : match.stage === 'finals'
                    ? '决赛'
                    : '展示'}
            </span>
          ) : null}
        </div>
        <div className="row" style={{ gap: 'var(--sp-1)' }}>
          <StatusBadge status={match.executionStatus} />
          <ResultBadge status={match.resultStatus} />
        </div>
      </div>

      {/* 排位赛跑图是单队项目：只显示本方，不显示“对手” */}
      <div className="stack stack--tight">
        <SideRow side={home} sideColor={sides ? (sides.first === 'red' ? 'red' : 'blue') : null} />
        {isRun ? null : (
          <SideRow side={away} sideColor={sides ? (sides.second === 'red' ? 'red' : 'blue') : null} />
        )}
      </div>

      {match.homeWins !== null && match.awayWins !== null ? (
        <div className="muted xsmall" style={{ marginTop: 'var(--sp-2)' }}>
          系列赛比分 {match.homeWins} : {match.awayWins}
          {match.notNeededGames.length > 0 ? ` · 第 ${match.notNeededGames.join('、')} 局不需要进行` : ''}
        </div>
      ) : null}

      {match.conflicts.length > 0 ? (
        <div className="badge badge--danger" style={{ marginTop: 'var(--sp-2)', whiteSpace: 'normal' }}>
          依赖不一致：{match.conflicts[0]}
        </div>
      ) : null}

      {!isRun ? (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <Link to={`/matches/${match.id}`} className="small">
            查看详情 →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function SideRow({
  side,
  sideColor = null,
}: {
  side: { team: Team | null; sourceLabel: string; score: string | null; isWinner: boolean } | null;
  sideColor?: Side | null;
}) {
  if (!side) return null;
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
      <div className="row" style={{ gap: 'var(--sp-2)', minWidth: 0, flex: 1 }}>
        {side.isWinner ? <span aria-label="胜者" title="胜者">✔</span> : <span aria-hidden="true" style={{ width: '1em' }} />}
        {sideColor ? <SideBadge side={sideColor} /> : null}
        <TeamName team={side.team} fallback={side.sourceLabel} />
      </div>
      {side.score !== null ? (
        <strong className="tabular" style={{ flexShrink: 0 }}>
          {side.score}
        </strong>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 关注队伍（仅存本机）
 * ------------------------------------------------------------------ */

const FOLLOW_KEY = 'rg26.following.v1';

function readFollowing(): string[] {
  try {
    const raw = localStorage.getItem(FOLLOW_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function useFollowing(): {
  following: string[];
  toggle: (teamId: string) => void;
  storageAvailable: boolean;
} {
  const [following, setFollowing] = useState<string[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);

  useEffect(() => {
    try {
      setFollowing(readFollowing());
    } catch {
      setStorageAvailable(false);
    }
  }, []);

  const toggle = useCallback((teamId: string) => {
    setFollowing((prev) => {
      const next = prev.includes(teamId) ? prev.filter((x) => x !== teamId) : [...prev, teamId];
      try {
        localStorage.setItem(FOLLOW_KEY, JSON.stringify(next));
      } catch {
        setStorageAvailable(false);
      }
      return next;
    });
  }, []);

  return { following, toggle, storageAvailable };
}

export function FollowButton({ teamId }: { teamId: string }) {
  const { following, toggle, storageAvailable } = useFollowing();
  const isFollowing = following.includes(teamId);
  return (
    <div className="stack stack--tight">
      <button
        type="button"
        className="btn btn--small"
        aria-pressed={isFollowing}
        onClick={() => toggle(teamId)}
      >
        {isFollowing ? '★ 已关注' : '☆ 关注该队'}
      </button>
      {!storageAvailable ? (
        <span className="xsmall muted">本机存储不可用，关注状态无法保存（不影响浏览）。</span>
      ) : (
        <span className="xsmall muted">关注只保存在本机浏览器，清理浏览器数据会丢失。</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 复制链接
 * ------------------------------------------------------------------ */

export function CopyLinkButton({ label = '复制链接', path }: { label?: string; path?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [manual, setManual] = useState('');

  const onCopy = async () => {
    const url = `${window.location.origin}${window.location.pathname}${path ? `#${path}` : window.location.hash}`;
    setManual(url);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        setState('ok');
      } else {
        setState('fail');
      }
    } catch {
      setState('fail');
    }
  };

  return (
    <div className="stack stack--tight">
      <button type="button" className="btn btn--small" onClick={() => void onCopy()}>
        {state === 'ok' ? '✓ 已复制' : label}
      </button>
      {state === 'fail' ? (
        <label className="xsmall muted">
          复制失败，请手动复制：
          <input className="input" readOnly value={manual} onFocus={(e) => e.currentTarget.select()} />
        </label>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 页面小节
 * ------------------------------------------------------------------ */

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="card__head" style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 className="card__title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
