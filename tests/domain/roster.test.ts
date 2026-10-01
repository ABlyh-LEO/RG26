/**
 * 队名与官方名单一致性测试。
 *
 * 名单由用户于 2026-10-01 提供，是**权威来源**。
 * 本测试用意：防止有人（包括未来的我）再凭低分辨率图片"修正"队名。
 *
 * 历史教训：曾据图片把「沫日堡垒队」写成「沬日堡垒队」、
 * 把「少微摸个鱼队」写成「少微模个鱼队」，两处都是错的。
 * 图片不足以分辨这类字形差异，必须以官方名单为准。
 */
import { describe, expect, it } from 'vitest';
import { eventFileSchema } from '../../src/domain/schema';
import { buildSeedEvent } from '../../scripts/seed-data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 官方竞技组名单，按三审排名 1–22。 */
const OFFICIAL_COMPETITIVE = [
  'Uniforest队',
  '机器曼妙队',
  '保卫萝卜队',
  'All Last队',
  '沫日堡垒队',
  '萝卜施工队',
  '吃饭要排队',
  '组一辈子战队',
  '肥西路奶龙拆迁大队',
  '拼好队',
  '煽风点火队',
  '西餐不好吃队',
  '黄瓜同好会',
  '我也要打rg吗，队',
  '名字够长就一定会有人看队',
  'Rg小队',
  '少微摸个鱼队',
  '超时空辉月机队',
  '啊对对队',
  '萝卜给猫队',
  'iRunTV队',
  'AAA平地起高楼施工队',
] as const;

/** 官方展示组名单，按队伍编号 1、2、3。 */
const OFFICIAL_SHOWCASE = ['晓啸启宇队', 'Aura-Bot', '海底小纵队'] as const;

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('队名与官方名单一致', () => {
  const event = eventFileSchema.parse(buildSeedEvent('2026-10-03T08:00:00+08:00'));

  it('竞技组 22 队队名逐项匹配（按三审排名顺序）', () => {
    const comp = event.teams
      .filter((t) => t.division === 'competitive')
      .sort((a, b) => (a.thirdReviewRank ?? 0) - (b.thirdReviewRank ?? 0));

    expect(comp).toHaveLength(22);
    comp.forEach((team, i) => {
      expect(team.name, `三审第 ${i + 1} 名`).toBe(OFFICIAL_COMPETITIVE[i]);
    });
  });

  it('展示组 3 队队名逐项匹配', () => {
    const show = event.teams.filter((t) => t.division === 'showcase').sort((a, b) => a.number - b.number);
    expect(show).toHaveLength(3);
    show.forEach((team, i) => {
      expect(team.name, `展示组第 ${i + 1} 队`).toBe(OFFICIAL_SHOWCASE[i]);
    });
  });

  it('所有队名都已标记为已核对，没有任何待核对项', () => {
    const unverified = event.teams.filter((t) => !t.nameVerified);
    expect(unverified.map((t) => t.name)).toEqual([]);
    // 已核对就不应保留 nameNote
    expect(event.teams.every((t) => t.nameNote === null)).toBe(true);
  });

  it('第 5 名用「沫」而非「沬」', () => {
    const fifth = event.teams.find((t) => t.thirdReviewRank === 5);
    expect(fifth?.name).toBe('沫日堡垒队');
    expect(fifth?.name).not.toContain('沬');
  });

  it('第 17 名用「摸」而非「模」', () => {
    const seventeenth = event.teams.find((t) => t.thirdReviewRank === 17);
    expect(seventeenth?.name).toBe('少微摸个鱼队');
    expect(seventeenth?.name).not.toContain('模');
  });

  it('第 14 名小写 rg、第 16 名大写 Rg，两者写法保留差异', () => {
    const r14 = event.teams.find((t) => t.thirdReviewRank === 14);
    const r16 = event.teams.find((t) => t.thirdReviewRank === 16);
    expect(r14?.name).toBe('我也要打rg吗，队');
    expect(r16?.name).toBe('Rg小队');
    // 确认确实是不同的大小写（不要"顺手统一"）
    expect(r14?.name.includes('rg')).toBe(true);
    expect(r16?.name.startsWith('Rg')).toBe(true);
  });

  it('提交到仓库的 data/event.json 与官方名单一致', () => {
    const onDisk = eventFileSchema.parse(JSON.parse(readFileSync(resolve(ROOT, 'data', 'event.json'), 'utf8')));
    const comp = onDisk.teams
      .filter((t) => t.division === 'competitive')
      .sort((a, b) => (a.thirdReviewRank ?? 0) - (b.thirdReviewRank ?? 0));
    expect(comp.map((t) => t.name)).toEqual([...OFFICIAL_COMPETITIVE]);

    const show = onDisk.teams.filter((t) => t.division === 'showcase').sort((a, b) => a.number - b.number);
    expect(show.map((t) => t.name)).toEqual([...OFFICIAL_SHOWCASE]);
  });

  it('公开快照里的队名也一致（避免忘记重新构建）', () => {
    const snap = JSON.parse(readFileSync(resolve(ROOT, 'public', 'data', 'event.json'), 'utf8')) as {
      data: { teams: { division: string; number: number; name: string; thirdReviewRank: number | null }[] };
    };
    const comp = snap.data.teams
      .filter((t) => t.division === 'competitive')
      .sort((a, b) => (a.thirdReviewRank ?? 0) - (b.thirdReviewRank ?? 0));
    expect(comp.map((t) => t.name)).toEqual([...OFFICIAL_COMPETITIVE]);
  });

  it('官方名单之外的队名不会出现在数据中', () => {
    const allowed = new Set<string>([...OFFICIAL_COMPETITIVE, ...OFFICIAL_SHOWCASE]);
    const unexpected = event.teams.filter((t) => !allowed.has(t.name));
    expect(unexpected.map((t) => t.name)).toEqual([]);
  });
});
