/**
 * 赛程时间必须与 `docs/` 内的赛程手册一致。
 *
 * 用户报告：「最后两场比赛的时间异常重合」——总决赛与表演赛都显示 16:35，
 * 与名额争夺战看起来同时开始。
 *
 * 手册（`docs/RoboGame2026赛程安排（暂定） (1).docx`）只把这一块写成
 * 「16:35 起，竞技组先行 BO3 总决赛名额争夺战…而后，竞技组进行 BO3 总决赛…
 * 此时间段最多比赛 6 场」+「总决赛结束后…15 分钟 BO2 表演赛」。
 * 按手册自身给出的量铺开成固定时段：
 *
 *   每场 10 分钟（手册「本赛段按每场 10 分钟、逐场进行编排」）
 *   两组 BO3 合计最多 6 局 → 16:35 + 6 × 10 分钟 = 17:35
 *   表演赛 15 分钟 BO2
 *
 * 即：名额争夺战 16:35–17:05、总决赛 17:05–17:35、表演赛 17:35–17:50。
 * 本文件把手册的时间表固化成断言，防止再次出现"照抄时间块起点"的写法。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventFileSchema, type EventFile, type ScheduleItem } from '../../src/domain/schema';
import { buildSeedEvent } from '../../scripts/seed-data';
import { validateEvent } from '../../src/domain/validation';

const ROOT = resolve(import.meta.dirname, '..', '..');
const LIVE = eventFileSchema.parse(JSON.parse(readFileSync(resolve(ROOT, 'data', 'event.json'), 'utf8')));
const SEED = eventFileSchema.parse(buildSeedEvent('2026-10-04T08:00:00+08:00'));

/** 手册「赛段三：决赛」的固定时间表（referenceId → 开始 / 结束）。 */
const FINALS_TABLE: readonly [referenceId: string, start: string, end: string | null, title: string][] = [
  ['F-M1', '11:10', '11:20', '八强双败首轮 · 第 1 名对第 5 名'],
  ['F-M2', '11:20', '11:30', '八强双败首轮 · 第 2 名对第 6 名'],
  ['F-M3', '11:30', '11:40', '八强双败首轮 · 第 3 名对第 7 名'],
  ['F-M4', '11:40', '11:50', '八强双败首轮 · 第 4 名对第 8 名'],
  ['opening', '14:00', '14:30', '决赛开幕式'],
  ['F-L1A', '14:30', '14:40', '八强败者组首轮 A'],
  ['F-L1B', '14:40', '14:50', '八强败者组首轮 B'],
  ['showcase-final-1', '14:50', '15:05', '展示组正式演出（抽签第 1 队）'],
  ['F-W1A', '15:05', '15:15', '八强胜者组 A'],
  ['F-W1B', '15:15', '15:25', '八强胜者组 B'],
  ['showcase-final-2', '15:25', '15:40', '展示组正式演出（抽签第 2 队）'],
  ['F-L2A', '15:40', '15:50', '败者组第二轮 A'],
  ['F-L2B', '15:50', '16:00', '败者组第二轮 B'],
  ['showcase-final-3', '16:00', '16:15', '展示组正式演出（抽签第 3 队）'],
  ['F-WSF', '16:15', '16:25', '半决赛胜者组'],
  ['F-LSF', '16:25', '16:35', '半决赛败者组'],
  ['F-QUAL', '16:35', '17:05', '总决赛名额争夺战'],
  ['F-GF', '17:05', '17:35', '总决赛'],
  ['exhibition', '17:35', '17:50', '表演赛'],
];

/** 手册各赛段的锚点时间（referenceId 或日程项 id → 开始 / 结束）。 */
const ANCHORS: readonly [id: string, start: string, end: string | null][] = [
  // 赛段一
  ['sched-qual-review', '15:20', '15:40'],
  ['sched-showcase-media', '10:50', '11:30'],
  ['sched-showcase-preview-1', '11:30', '11:45'],
  ['sched-showcase-preview-2', '11:45', '12:00'],
  ['sched-showcase-preview-3', '12:00', '12:15'],
  // 赛段二（10 月 3 日）
  ['sched-swiss-r1-00-1', '16:00', '16:10'],
  ['sched-swiss-r2-10-1', '18:00', '18:10'],
  ['sched-swiss-r3-20-1', '19:40', '19:50'],
  // 赛段二（10 月 4 日）
  ['sched-swiss-r4-21-1', '09:00', '09:10'],
  ['sched-swiss-r5-22-1', '10:20', '10:30'],
];

function at(item: ScheduleItem | undefined, label: string): string | null {
  if (!item) throw new Error(`找不到日程项：${label}`);
  return item.revisedStart ?? item.plannedStart;
}

function timeOf(iso: string | null): string | null {
  return iso === null ? null : iso.slice(11, 16);
}

function byReference(event: EventFile, referenceId: string): ScheduleItem | undefined {
  return event.scheduleItems.find((item) => item.referenceId === referenceId);
}

function byId(event: EventFile, id: string): ScheduleItem | undefined {
  return event.scheduleItems.find((item) => item.id === id);
}

describe('决赛日时间与赛程手册一致', () => {
  for (const [referenceId, start, end, title] of FINALS_TABLE) {
    it(`${title} ${start}${end ? `–${end}` : ''}`, () => {
      for (const [label, event] of [['data/event.json', LIVE], ['seed', SEED]] as const) {
        const item = byReference(event, referenceId);
        expect(item, `${label} 缺少 ${referenceId}`).toBeDefined();
        expect(timeOf(at(item, referenceId)), `${label} ${referenceId} 开始时间`).toBe(start);
        expect(timeOf(item!.plannedEnd), `${label} ${referenceId} 结束时间`).toBe(end);
        expect(item!.afterSeriesId, `${label} ${referenceId} 依赖`).toBe(referenceId === 'F-GF' ? 'F-QUAL' : referenceId === 'exhibition' ? 'F-GF' : null);
      }
    });
  }
});

describe('赛段锚点与手册一致', () => {
  for (const [id, start, end] of ANCHORS) {
    it(`${id} ${start}${end ? `–${end}` : ''}`, () => {
      for (const [label, event] of [['data/event.json', LIVE], ['seed', SEED]] as const) {
        const item = byId(event, id);
        expect(item, `${label} 缺少 ${id}`).toBeDefined();
        expect(timeOf(at(item, id)), `${label} ${id} 开始时间`).toBe(start);
        expect(timeOf(item!.plannedEnd), `${label} ${id} 结束时间`).toBe(end);
      }
    });
  }

  it('排位赛两轮分别在 09:00 与 13:30 开始，每批 10 分钟', () => {
    const runs = LIVE.qualification.runs;
    const starts = (round: 1 | 2) =>
      [...new Set(runs.filter((run) => run.round === round).map((run) => {
        const item = LIVE.scheduleItems.find((s) => s.id === run.scheduleItemId)!;
        return timeOf(at(item, run.scheduleItemId));
      }))].sort();
    expect(starts(1)[0]).toBe('09:00');
    expect(starts(1).at(-1)).toBe('10:40');
    expect(starts(2)[0]).toBe('13:30');
    expect(starts(2).at(-1)).toBe('15:10');
    expect(starts(1)).toHaveLength(11);
  });
});

describe('时间不重合、依赖不倒挂', () => {
  it('同一场地同一时间只有一项安排', () => {
    const byVenue = new Map<string, { id: string; start: number; end: number }[]>();
    for (const item of LIVE.scheduleItems) {
      if (item.venueId === null || item.plannedEnd === null) continue;
      const key = `${item.date}|${item.venueId}`;
      byVenue.set(key, [...(byVenue.get(key) ?? []), {
        id: item.id,
        start: Date.parse(item.revisedStart ?? item.plannedStart),
        end: Date.parse(item.plannedEnd),
      }]);
    }
    const overlaps: string[] = [];
    for (const [key, list] of byVenue) {
      const ordered = [...list].sort((a, b) => a.start - b.start);
      for (let index = 1; index < ordered.length; index += 1) {
        if (ordered[index]!.start < ordered[index - 1]!.end) overlaps.push(`${key}: ${ordered[index - 1]!.id} → ${ordered[index]!.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('前序依赖的下一项不早于前一项结束', () => {
    const violations: string[] = [];
    for (const item of LIVE.scheduleItems) {
      if (item.afterSeriesId === null) continue;
      const previous = LIVE.scheduleItems.find((candidate) => candidate.referenceId === item.afterSeriesId);
      if (!previous) continue;
      const boundary = previous.plannedEnd ?? previous.plannedStart;
      if (Date.parse(at(item, item.id)!) < Date.parse(boundary)) violations.push(item.id);
    }
    expect(violations).toEqual([]);
  });

  it('BO3 时间块与手册的上限一致（最多 6 局 × 10 分钟）', () => {
    const qual = byReference(LIVE, 'F-QUAL')!;
    const gf = byReference(LIVE, 'F-GF')!;
    const showcase = byReference(LIVE, 'exhibition')!;
    const tenMinutes = 10 * 60 * 1000;
    expect(Date.parse(gf.plannedEnd!) - Date.parse(qual.plannedStart)).toBe(6 * tenMinutes);
    expect(Date.parse(showcase.plannedEnd!) - Date.parse(showcase.plannedStart)).toBe(15 * 60 * 1000);
  });
});

describe('校验器守住这两类问题', () => {
  it('照抄时间块起点（三场都是 16:35、结束未知）会被拒绝', () => {
    const legacy: EventFile = {
      ...LIVE,
      scheduleItems: LIVE.scheduleItems.map((item) =>
        item.id === 'sched-F-GF' || item.id === 'sched-exhibition'
          ? { ...item, plannedStart: '2026-10-04T16:35:00+08:00', plannedEnd: null }
          : item.id === 'sched-F-QUAL'
            ? { ...item, plannedEnd: null }
            : item,
      ),
    };
    const codes = validateEvent(legacy).errors.map((error) => error.code);
    expect(codes).toContain('sequence-overlap');
    expect(codes).toContain('venue-time-collision');
  });

  it('当前正式数据通过校验', () => {
    expect(validateEvent(LIVE).errors).toEqual([]);
    expect(validateEvent(SEED).errors).toEqual([]);
  });
});

describe('公开快照已按新时间重新构建', () => {
  it('public/data/event.json 的决赛时间与正式源一致（避免忘记重新构建）', () => {
    const snapshot = JSON.parse(readFileSync(resolve(ROOT, 'public', 'data', 'event.json'), 'utf8')) as { data: unknown };
    const published = eventFileSchema.parse(snapshot.data);
    for (const [referenceId, start, end] of FINALS_TABLE) {
      const item = byReference(published, referenceId);
      expect(item, `公开快照缺少 ${referenceId}`).toBeDefined();
      expect(timeOf(at(item, referenceId)), `公开快照 ${referenceId} 开始时间`).toBe(start);
      expect(timeOf(item!.plannedEnd), `公开快照 ${referenceId} 结束时间`).toBe(end);
    }
  });
});
