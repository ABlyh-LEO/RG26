import type { EventFile } from '../domain/schema';

export function describeEventUpdate(before: EventFile, after: EventFile): string | null {
  const beforeResults = new Map<string, string>([
    ...before.qualification.runs.map((run) => [run.id, JSON.stringify(run)] as const),
    ...before.swiss.matches.map((match) => [match.id, JSON.stringify([match.attempts, match.effectiveAttemptId])] as const),
    ...before.finals.series.map((series) => [series.id, JSON.stringify(series.games)] as const),
  ]);
  const afterResults = [
    ...after.qualification.runs.map((run) => [run.id, JSON.stringify(run)] as const),
    ...after.swiss.matches.map((match) => [match.id, JSON.stringify([match.attempts, match.effectiveAttemptId])] as const),
    ...after.finals.series.map((series) => [series.id, JSON.stringify(series.games)] as const),
  ];
  const results = afterResults.filter(([id, value]) => beforeResults.get(id) !== value).length;
  const schedule = new Map(before.scheduleItems.map((item) => [item.id, JSON.stringify([item.plannedStart, item.revisedStart, item.venueId])]));
  const times = after.scheduleItems.filter((item) => schedule.get(item.id) !== JSON.stringify([item.plannedStart, item.revisedStart, item.venueId])).length;
  const notices = after.notices.filter((notice) => !before.notices.some((old) => JSON.stringify(old) === JSON.stringify(notice))).length;
  const parts = [results ? `${results} 场成绩` : '', times ? `${times} 项时间或场地` : '', notices ? `${notices} 条公告` : ''].filter(Boolean);
  return parts.length ? `已更新：${parts.join('、')}` : JSON.stringify(before) !== JSON.stringify(after) ? '赛事对阵或状态已更新' : null;
}
