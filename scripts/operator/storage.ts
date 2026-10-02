import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eventFileSchema, type EventFile } from '../../src/domain/schema';
import type { ChangeSummary } from '../../src/operator/contracts';

export function revision(event: EventFile): string {
  return createHash('sha256').update(JSON.stringify(eventFileSchema.parse(event))).digest('hex').slice(0, 32);
}
export async function optionalText(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function atomicText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => undefined); }
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Field-level diff retains changed scores, names and statuses instead of mere record counts. */
export function summarizeChanges(before: EventFile, after: EventFile): ChangeSummary[] {
  const changes: ChangeSummary[] = [];
  const labels: Record<string, string> = {
    homeScore: '第一席积分', awayScore: '第二席积分', homeReachedSeconds: '第一席到分时间',
    awayReachedSeconds: '第二席到分时间', winnerId: '胜者', score: '积分', elapsedSeconds: '到分时间',
    resultStatus: '成绩状态', executionStatus: '现场状态', publicationStatus: '公布状态',
    revisedStart: '修订时间', drawOrder: '抽签顺序', orderedTeamIds: '排位顺序', body: '公告内容',
    event: '赛事', qualification: '排位赛', runs: '跑图成绩', ranking: '排名', swiss: '瑞士轮', matches: '比赛',
    rounds: '轮次', finals: '决赛', series: '系列赛', games: '小局', attempts: '比赛记录', notices: '公告',
    schedule: '日程', scheduleItems: '日程', corrections: '更正记录', showcase: '展示组', seeding: '八强种子',
    title: '标题', note: '备注', judgeNote: '裁判备注', rawResult: '成绩文字', reason: '原因', status: '状态',
    sourceNote: '来源说明', adjustmentNote: '调整说明', homeTeamId: '第一席队伍', awayTeamId: '第二席队伍',
    teamId: '队伍', participantSnapshot: '已公布参赛双方', resultKind: '结果类型', effectiveAttemptId: '采用的记录',
    supersedesId: '替代的记录', disposition: '处置方式', dispositionNote: '处置说明', publishedAt: '公布时间',
    bestResultLabels: '最优成绩', scheduleNotice: '赛程说明', plannedStart: '原计划时间', slots: '席位来源',
    previousValue: '更正前记录', newValue: '更正后记录', affectedIds: '受影响场次', allowsProgress: '允许继续推进',
    severity: '公告级别', at: '记录时间', seeds: '种子席位', calculationVersion: '计算版本',
    matchIds: '场次', pairingVersion: '配对版本', basedOnRound: '依据轮次', basedOnRevision: '依据数据版本',
    closedAt: '整轮确认时间', rankingSnapshot: '配对排名快照', revisionNote: '修订说明', basisNote: '种子依据',
    version: '版本', record: '战绩组', wins: '胜场', losses: '负场', rankWithinGroup: '组内名次',
    r: 'R 值', p: '积分 P', t: '用时 T', n: '分子', d: '分母',
  };
  const names = new Map(after.teams.map((team) => [team.id, team.name]));
  const objects = new Map<string, string>(names);
  for (const event of [before, after]) {
    for (const item of event.scheduleItems) { objects.set(item.id, item.title); if (item.referenceId) objects.set(item.referenceId, item.title); }
    for (const run of event.qualification.runs) objects.set(run.id, `${names.get(run.teamId) ?? run.teamId} · 排位赛第 ${run.round} 轮`);
    for (const notice of event.notices) objects.set(notice.id, notice.title);
    for (const round of event.swiss.rounds) objects.set(round.id, `瑞士轮第 ${round.index} 轮`);
    for (const correction of event.corrections) objects.set(correction.id, correction.reason);
    for (const series of event.finals.series) for (const game of series.games) objects.set(game.id, `第 ${game.index} 局`);
    for (const match of event.swiss.matches) match.attempts.forEach((attempt, index) => objects.set(attempt.id, `第 ${index + 1} 次记录`));
  }
  const values: Record<string, string> = { confirmed: '已确认', provisional: '待确认', none: '未录入', published: '已公布',
    draft: '草稿', pending: '待处理', scheduled: '未开赛', ready: '待开始', running: '进行中', finished: '已结束',
    delayed: '已延迟', cancelled: '已取消', 'not-needed': '无需进行', superseded: '已被替代',
    normal: '正常比赛', 'early-end': '提前结束', 'walkover-before-start': '未开赛弃权', 'administrative-stop': '行政判负中止',
    'downstream-not-published': '下游未公布，重算候选', 'keep-published-with-note': '保留已公布对阵并说明',
    republish: '作废并重新公布', 'committee-revision-recorded': '已记录组委会处置',
    info: '信息', warning: '注意', critical: '重要' };
  const show = (value: unknown): string => {
    if (value === undefined || value === null) return '—';
    if (typeof value === 'string') return objects.get(value) ?? values[value] ?? value;
    if (Array.isArray(value)) return value.map(show).join(' → ');
    if (typeof value === 'boolean') return value ? '是' : '否';
    return JSON.stringify(value);
  };
  const labelFor = (path: string): string => path.split('.').map((part) => {
    const bracket = /^([^[]+)\[([^\]]+)\]$/.exec(part);
    if (!bracket) return labels[part] ?? part;
    const key = bracket[1]!; const id = bracket[2]!;
    return objects.get(id) ?? (key === 'games' ? `第 ${id} 局` : `${labels[key] ?? key} ${id}`);
  }).join(' / ');
  function visit(a: unknown, b: unknown, path: string): void {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const aa = a ?? (Array.isArray(b) ? [] : {}); const bb = b ?? (Array.isArray(a) ? [] : {});
    const identity = (value: unknown): string | null => value && typeof value === 'object'
      ? 'id' in value ? String(value.id) : 'index' in value ? String(value.index) : 'teamId' in value ? String(value.teamId) : null : null;
    if (Array.isArray(aa) && Array.isArray(bb) && [...aa, ...bb].every((value) => identity(value) !== null)) {
      const old = new Map(aa.map((value: unknown) => [identity(value)!, value]));
      const next = new Map(bb.map((value: unknown) => [identity(value)!, value]));
      for (const id of new Set([...old.keys(), ...next.keys()])) visit(old.get(id), next.get(id), `${path}[${id}]`);
    } else if (aa && bb && typeof aa === 'object' && typeof bb === 'object' && !Array.isArray(aa) && !Array.isArray(bb)) {
      const old = aa as Record<string, unknown>; const next = bb as Record<string, unknown>;
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (['contentUpdatedAt', 'confirmedAt', 'id', 'index'].includes(key)) continue;
        visit(old[key], next[key], path ? `${path}.${key}` : key);
      }
    } else {
      const ordered = (value: unknown) => Array.isArray(value) ? value.map((id, index) => `${index + 1}. ${show(id)}`).join('；') : show(value);
      const format = path.endsWith('.orderedTeamIds') || path.endsWith('.drawOrder') ? ordered : show;
      changes.push({ path, label: labelFor(path), before: format(a), after: format(b) });
    }
  }
  visit(before, after, '');
  return changes;
}
