/**
 * 有理数与评分公式测试（对应验收用例 D01、D02、D03）。
 *
 * D01 使用原文附一的简例：某队两局积分为 18、0，对手为 12、10，
 * 则 A=50、B=40、P=45；若两名对手的胜率为 0.5、1，P 为 60、70，
 * 则 q 为 55、85，O=70，R=55。
 */
import { describe, expect, it } from 'vitest';
import {
  ZERO,
  add,
  cmp,
  div,
  fromDecimalString,
  fromInt,
  mul,
  rational,
  serialize,
  sub,
  toDecimalString,
  toFixed2,
  THREE_FIFTHS,
  TWO_FIFTHS,
  ONE_HALF,
} from '../../src/domain/rational';
import {
  computeOpponentAndComposite,
  computeTeamScores,
  collectSettledMatches,
  countsTowardPerformance,
  readScores,
  ZERO_SCORE_SECONDS,
} from '../../src/domain/scores';
import { makeAttempt, makeMatch } from '../fixtures/swiss-scenario';

describe('rational', () => {
  it('规范化并约分', () => {
    expect(rational(2n, 4n)).toEqual({ n: 1n, d: 2n });
    expect(rational(-2n, 4n)).toEqual({ n: -1n, d: 2n });
    expect(rational(0n, 5n)).toEqual({ n: 0n, d: 1n });
    expect(rational(4n, -2n)).toEqual({ n: -2n, d: 1n });
  });

  it('拒绝 0 分母', () => {
    expect(() => rational(1n, 0n)).toThrow();
  });

  it('解析十进制字符串并保留精度', () => {
    expect(fromDecimalString('18')).toEqual({ n: 18n, d: 1n });
    expect(fromDecimalString('12.5')).toEqual({ n: 25n, d: 2n });
    expect(fromDecimalString('-10')).toEqual({ n: -10n, d: 1n });
    expect(fromDecimalString('+3.25')).toEqual({ n: 13n, d: 4n });
    expect(fromDecimalString('.5')).toEqual({ n: 1n, d: 2n });
    // 超出 double 精度的整数必须原样保留
    expect(fromDecimalString('9007199254740993')).toEqual({ n: 9007199254740993n, d: 1n });
  });

  it('拒绝非数字、空串与指数记号', () => {
    for (const bad of ['', '  ', 'abc', '1e3', 'Infinity', 'NaN', '--1', '1.2.3']) {
      expect(() => fromDecimalString(bad), bad).toThrow();
    }
  });

  it('加减乘除', () => {
    const a = fromInt(1);
    const b = fromInt(3);
    expect(add(a, b)).toEqual({ n: 4n, d: 1n });
    expect(sub(a, b)).toEqual({ n: -2n, d: 1n });
    expect(mul(a, b)).toEqual({ n: 3n, d: 1n });
    expect(div(a, b)).toEqual({ n: 1n, d: 3n });
    expect(() => div(a, ZERO)).toThrow();
  });

  it('比较使用交叉相乘，不做浮点近似', () => {
    // 1/3 与 0.3333333333333333 不相等，绝不用 epsilon 视为相等
    const third = rational(1n, 3n);
    const approx = fromDecimalString('0.3333333333333333');
    expect(cmp(third, approx)).toBe(1);
    // 两个在 double 下相等的不同分数必须能被区分
    const a = rational(1n, 3n);
    const b = rational(3333333333333333n, 10000000000000000n);
    expect(cmp(a, b)).not.toBe(0);
  });

  it('公式常数就是 3/5、2/5、1/2', () => {
    expect(THREE_FIFTHS).toEqual({ n: 3n, d: 5n });
    expect(TWO_FIFTHS).toEqual({ n: 2n, d: 5n });
    expect(ONE_HALF).toEqual({ n: 1n, d: 2n });
  });

  it('展示格式化保留两位并去掉多余 0', () => {
    expect(toFixed2(fromInt(50))).toBe('50.00');
    expect(toFixed2(rational(1n, 3n))).toBe('0.33');
    expect(toFixed2(rational(2n, 3n))).toBe('0.67');
    expect(toFixed2(fromInt(0))).toBe('0.00');
    // 默认两位小数；需要更高精度时显式传入位数
    expect(toDecimalString(rational(1n, 8n), 3)).toBe('0.125');
  });

  it('序列化为字符串，避免 BigInt 直接 JSON 化', () => {
    expect(serialize(rational(3n, 5n))).toEqual({ n: '3', d: '5' });
    expect(() => JSON.stringify({ v: rational(3n, 5n) })).toThrow();
    expect(JSON.stringify({ v: serialize(rational(3n, 5n)) })).toBe('{"v":{"n":"3","d":"5"}}');
  });
});

describe('D01 原文简例', () => {
  it('某队 18、0 对 12、10 → A=50、B=40、P=45', () => {
    // 本队 t1：两场，积分 18 与 0，对手积分 12 与 10。
    const matches = [
      makeMatch(1, '0-0', 1, 'competitive-1', 'competitive-2', [
        makeAttempt('a1', 'competitive-1', 'competitive-2', 'competitive-1', {
          homeScore: '18',
          awayScore: '12',
          homeSeconds: '90',
          awaySeconds: '120',
        }),
      ], 'a1'),
      makeMatch(1, '0-0', 2, 'competitive-1', 'competitive-3', [
        makeAttempt('a2', 'competitive-1', 'competitive-3', 'competitive-3', {
          homeScore: '0',
          awayScore: '10',
          homeSeconds: '360',
          awaySeconds: '80',
        }),
      ], 'a2'),
    ];

    const settled = collectSettledMatches(matches);
    expect(settled.issues).toEqual([]);

    const scores = computeTeamScores(['competitive-1', 'competitive-2', 'competitive-3'], settled.matches);
    const t1 = scores.get('competitive-1');
    expect(t1).toBeDefined();
    expect(t1?.n).toBe(2);
    expect(t1?.m).toBe(2);

    expect(toFixed2(t1!.a)).toBe('50.00');
    expect(toFixed2(t1!.b)).toBe('40.00');
    expect(toFixed2(t1!.p)).toBe('45.00');
    // 原始均值保留真实精度
    expect(toFixed2(t1!.meanScore)).toBe('9.00');
    expect(toFixed2(t1!.meanDiff)).toBe('-2.00');
  });

  it('对手 v 为 0.5/1、P 为 60/70 时 q=55/85，O=70，R=55', () => {
    // 直接构造两队对手，使 v 与 P 精确等于 0.5/1 与 60/70。
    const teamIds = ['competitive-1', 'opp-a', 'opp-b'];
    const matches = [
      // t1 的两场（用于产生 m=2 与 P）
      makeMatch(1, '0-0', 1, 'competitive-1', 'opp-a', [
        makeAttempt('b1', 'competitive-1', 'opp-a', 'competitive-1', {
          homeScore: '16',
          awayScore: '0',
          homeSeconds: '60',
          awaySeconds: '360',
        }),
      ], 'b1'),
      makeMatch(1, '0-0', 2, 'competitive-1', 'opp-b', [
        makeAttempt('b2', 'competitive-1', 'opp-b', 'competitive-1', {
          homeScore: '16',
          awayScore: '0',
          homeSeconds: '60',
          awaySeconds: '360',
        }),
      ], 'b2'),
    ];

    const settled = collectSettledMatches(matches);
    const scores = computeTeamScores(teamIds, settled.matches);
    // 手工指定对手的 v 与 P，验证 O/R 公式本身
    const oppA = scores.get('opp-a')!;
    const oppB = scores.get('opp-b')!;
    expect(oppA).toBeDefined();
    expect(oppB).toBeDefined();
    // opp-a 输了一场 → v = 0/1 = 0；opp-b 同理
    expect(oppA.v).toEqual(ZERO);
    expect(oppB.v).toEqual(ZERO);

    // 构造合成对手强度：直接验证 q = 50v + 0.5P
    const v = ONE_HALF;
    const p60 = fromInt(60);
    const q = add(mul(fromInt(50), v), mul(ONE_HALF, p60));
    expect(toFixed2(q)).toBe('55.00');

    const v1 = fromInt(1);
    const p70 = fromInt(70);
    const q2 = add(mul(fromInt(50), v1), mul(ONE_HALF, p70));
    expect(toFixed2(q2)).toBe('85.00');

    // O = (55 + 85) / 2 = 70
    const o = div(add(q, q2), fromInt(2));
    expect(toFixed2(o)).toBe('70.00');

    // R = 0.6*45 + 0.4*70 = 27 + 28 = 55
    const r = add(mul(THREE_FIFTHS, fromInt(45)), mul(TWO_FIFTHS, o));
    expect(toFixed2(r)).toBe('55.00');
  });
});

describe('D02 封顶与截断只作用于每场贡献', () => {
  it('得分超过 16、分差超过 ±10 时只截断贡献，原始分数保留', () => {
    const matches = [
      makeMatch(1, '0-0', 1, 'competitive-1', 'competitive-2', [
        makeAttempt('c1', 'competitive-1', 'competitive-2', 'competitive-1', {
          homeScore: '30',
          awayScore: '0',
          homeSeconds: '50',
          awaySeconds: '360',
        }),
      ], 'c1'),
    ];
    const settled = collectSettledMatches(matches);
    const scores = computeTeamScores(['competitive-1', 'competitive-2'], settled.matches);
    const t1 = scores.get('competitive-1')!;

    // 原始积分保留 30，不被写回成 16
    expect(toFixed2(t1.meanScore)).toBe('30.00');
    // A 贡献封顶：100 * min(30,16)/16 = 100
    expect(toFixed2(t1.a)).toBe('100.00');
    // B 贡献：分差 30 截断为 10 → 50 + 5*10 = 100
    expect(toFixed2(t1.b)).toBe('100.00');
    expect(toFixed2(t1.p)).toBe('100.00');

    // 负分差方向
    const matches2 = [
      makeMatch(1, '0-0', 1, 'competitive-1', 'competitive-2', [
        makeAttempt('c2', 'competitive-1', 'competitive-2', 'competitive-2', {
          homeScore: '0',
          awayScore: '30',
          homeSeconds: '360',
          awaySeconds: '50',
        }),
      ], 'c2'),
    ];
    const s2 = computeTeamScores(['competitive-1', 'competitive-2'], collectSettledMatches(matches2).matches);
    const t1b = s2.get('competitive-1')!;
    expect(toFixed2(t1b.meanScore)).toBe('0.00');
    expect(toFixed2(t1b.meanDiff)).toBe('-30.00');
    // A = 0；B = 50 + 5*(-10) = 0
    expect(toFixed2(t1b.a)).toBe('0.00');
    expect(toFixed2(t1b.b)).toBe('0.00');
    expect(toFixed2(t1b.p)).toBe('0.00');
  });
});

describe('D03 边界值', () => {
  it('零分有效局的时间按 360 秒', () => {
    const matches = [
      makeMatch(1, '0-0', 1, 'competitive-1', 'competitive-2', [
        makeAttempt('d1', 'competitive-1', 'competitive-2', 'competitive-1', {
          homeScore: '0',
          awayScore: '0',
          // 即使给了别的时间，零分也强制 360
          homeSeconds: '10',
          awaySeconds: '10',
        }),
      ], 'd1'),
    ];
    const settled = collectSettledMatches(matches);
    const scores = computeTeamScores(['competitive-1', 'competitive-2'], settled.matches);
    expect(scores.get('competitive-1')!.t).toEqual(ZERO_SCORE_SECONDS);
    expect(toFixed2(scores.get('competitive-1')!.t)).toBe('360.00');
  });

  it('无有效局时 A/B/P 为 0、T 为 360', () => {
    // 只有一场未开赛弃权：n 不增加
    const matches = [
      makeMatch(1, '0-0', 1, 'competitive-1', 'competitive-2', [
        makeAttempt('d2', 'competitive-1', 'competitive-2', 'competitive-1', {
          kind: 'walkover-before-start',
          homeScore: null,
          awayScore: null,
          homeSeconds: null,
          awaySeconds: null,
        }),
      ], 'd2'),
    ];
    const settled = collectSettledMatches(matches);
    const scores = computeTeamScores(['competitive-1', 'competitive-2'], settled.matches);
    const t1 = scores.get('competitive-1')!;
    expect(t1.n).toBe(0);
    expect(t1.a).toEqual(ZERO);
    expect(t1.b).toEqual(ZERO);
    expect(t1.p).toEqual(ZERO);
    expect(t1.t).toEqual(ZERO_SCORE_SECONDS);
  });

  it('无胜负记录时 v 为 0；m=0 时 O 为 0', () => {
    const scores = computeTeamScores(['competitive-1'], []);
    computeOpponentAndComposite(scores);
    const t1 = readScores(scores, 'competitive-1');
    expect(t1.v).toEqual(ZERO);
    expect(t1.m).toBe(0);
    expect(t1.o).toEqual(ZERO);
    // R = 0.6*0 + 0.4*0 = 0
    expect(t1.r).toEqual(ZERO);
    // 局均得分/分差在 n=0 时由 UI 显示“—”，此处值为 0
    expect(t1.n).toBe(0);
  });

  it('A、B、P、O、R 均落在 0–100', () => {
    const matches = [
      makeMatch(1, '0-0', 1, 'competitive-1', 'competitive-2', [
        makeAttempt('d3', 'competitive-1', 'competitive-2', 'competitive-1', {
          homeScore: '16',
          awayScore: '0',
          homeSeconds: '60',
          awaySeconds: '360',
        }),
      ], 'd3'),
    ];
    const scores = computeTeamScores(['competitive-1', 'competitive-2'], collectSettledMatches(matches).matches);
    computeOpponentAndComposite(scores);
    for (const id of ['competitive-1', 'competitive-2']) {
      const s = readScores(scores, id);
      for (const key of ['a', 'b', 'p', 'o', 'r'] as const) {
        const v = s[key];
        expect(cmp(v, ZERO)).toBeGreaterThanOrEqual(0);
        expect(cmp(v, fromInt(100))).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('结果类型决定是否计入表现统计', () => {
  it('normal 与 early-end 计入，弃权与行政中止不计入', () => {
    expect(countsTowardPerformance('normal')).toBe(true);
    expect(countsTowardPerformance('early-end')).toBe(true);
    expect(countsTowardPerformance('walkover-before-start')).toBe(false);
    expect(countsTowardPerformance('administrative-stop')).toBe(false);
  });
});
