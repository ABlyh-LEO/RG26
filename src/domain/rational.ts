/**
 * 本项目需要的小型有理数运算。
 *
 * 目标（见 docs/IMPLEMENTATION_PLAN.md 第 5.4 节）：
 * - 规范化的 BigInt 分子/分母
 * - 十进制字符串解析
 * - 加减乘除、比较、显示格式化
 * - 比较使用交叉相乘，绝不用 epsilon 把不等值强行视为相等
 * - 展示阶段才保留两位小数
 *
 * 这不是通用数学框架：不实现幂、根、三角、任意精度超越函数。
 * 领域层所有评分比较都必须走这里，以保证“按原始精度排序”。
 */

/** 规范化（既约、分母为正、零记为 0/1）的有理数。 */
export interface Rational {
  /** 分子，符号在此。 */
  readonly n: bigint;
  /** 分母，恒为正。 */
  readonly d: bigint;
}

export class RationalError extends Error {
  override readonly name = 'RationalError';
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** 用已校验的分子分母构造既约有理数。denominator 不得为 0。 */
export function rational(numerator: bigint, denominator: bigint = 1n): Rational {
  if (denominator === 0n) throw new RationalError('分母不能为 0');
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { n: 0n, d: 1n };
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const ZERO: Rational = { n: 0n, d: 1n };
export const ONE: Rational = { n: 1n, d: 1n };

/** 常用常数：公式里的 0.6、0.4、0.5 就是 3/5、2/5、1/2。 */
export const THREE_FIFTHS = rational(3n, 5n);
export const TWO_FIFTHS = rational(2n, 5n);
export const ONE_HALF = rational(1n, 2n);

export function fromInt(value: number | bigint): Rational {
  if (typeof value === 'bigint') return rational(value);
  if (!Number.isInteger(value)) {
    throw new RationalError(`fromInt 只接受整数，收到 ${value}`);
  }
  return rational(BigInt(value));
}

const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * 解析十进制字符串（例如 "18"、"12.5"、"-10"、"+3.25"）。
 * 保留实际精度：不经过 Number，因此不会丢失超出 double 的有效位。
 * 拒绝空串、非数字、指数记号和 Infinity/NaN。
 */
export function fromDecimalString(text: string): Rational {
  const trimmed = text.trim();
  if (trimmed === '') throw new RationalError('空字符串不是有效数值');
  if (!DECIMAL_RE.test(trimmed)) {
    throw new RationalError(`不是有效的十进制数值：${JSON.stringify(text)}`);
  }
  let sign = 1n;
  let body = trimmed;
  if (body.startsWith('+')) body = body.slice(1);
  else if (body.startsWith('-')) {
    sign = -1n;
    body = body.slice(1);
  }
  const dot = body.indexOf('.');
  if (dot === -1) {
    return rational(sign * BigInt(body), 1n);
  }
  const intPart = body.slice(0, dot);
  const fracPart = body.slice(dot + 1);
  const digits = `${intPart}${fracPart}`;
  const scale = 10n ** BigInt(fracPart.length);
  return rational(sign * BigInt(digits === '' ? '0' : digits), scale);
}

/** 从 JSON 中读回的 {n,d} 字符串对还原有理数；用于快照序列化。 */
export function fromSerialized(n: string, d: string): Rational {
  return rational(BigInt(n), BigInt(d));
}

export function add(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new RationalError('除以 0');
  return rational(a.n * b.d, a.d * b.n);
}

export function neg(a: Rational): Rational {
  return { n: -a.n, d: a.d };
}

/** 交叉相乘比较，不做任何浮点近似。 */
export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.n * b.d;
  const right = b.n * a.d;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function eq(a: Rational, b: Rational): boolean {
  return a.n === b.n && a.d === b.d;
}

export function isZero(a: Rational): boolean {
  return a.n === 0n;
}

export function isNegative(a: Rational): boolean {
  return a.n < 0n;
}

export function min(a: Rational, b: Rational): Rational {
  return cmp(a, b) <= 0 ? a : b;
}

export function max(a: Rational, b: Rational): Rational {
  return cmp(a, b) >= 0 ? a : b;
}

/** 把有理数限制在 [lo, hi]。 */
export function clamp(value: Rational, lo: Rational, hi: Rational): Rational {
  if (cmp(value, lo) < 0) return lo;
  if (cmp(value, hi) > 0) return hi;
  return value;
}

/**
 * 紧凑的十进制展开，最多 maxDecimals 位小数，四舍五入（half away from zero），
 * 并去掉尾随的 0。用于展示，绝不用于比较。
 */
export function toDecimalString(value: Rational, maxDecimals = 2): string {
  if (maxDecimals < 0) throw new RationalError('maxDecimals 不能为负');
  const negative = value.n < 0n;
  const absN = negative ? -value.n : value.n;
  const scale = 10n ** BigInt(maxDecimals);
  const scaledNum = absN * scale;
  let q = scaledNum / value.d;
  const r = scaledNum % value.d;
  // 四舍五入：余数 >= 分母的一半则进位
  if (r * 2n >= value.d) q += 1n;
  const digits = q.toString().padStart(maxDecimals + 1, '0');
  const intPart = digits.slice(0, digits.length - maxDecimals);
  const fracPart = maxDecimals === 0 ? '' : digits.slice(digits.length - maxDecimals);
  const trimmedFrac = fracPart.replace(/0+$/, '');
  const sign = negative && q !== 0n ? '-' : '';
  return trimmedFrac === '' ? `${sign}${intPart}` : `${sign}${intPart}.${trimmedFrac}`;
}

/**
 * 固定两位小数的展示形式；n=0 等无意义场景由调用方决定显示“—”，不在这里发明。
 * -0 归一为 0。
 */
export function toFixed2(value: Rational): string {
  const text = toDecimalString(value, 2);
  const [intPart, fracPart = ''] = text.split('.');
  const padded = (fracPart + '00').slice(0, 2);
  const normalizedInt = intPart === '-0' ? '0' : intPart;
  return `${normalizedInt}.${padded}`;
}

/** 粗略的数值近似。仅用于排序以外的展示/诊断，不参与任何比较决策。 */
export function toApproxNumber(value: Rational): number {
  if (value.d === 1n) return Number(value.n);
  // 通过定点缩放避免 BigInt->Number 的溢出。
  const scale = 1_000_000_000n;
  const scaled = (value.n * scale) / value.d;
  return Number(scaled) / 1e9;
}

/**
 * 序列化：分子/分母转为字符串。
 * 绝不直接 JSON.stringify({n,d})，否则会抛 "Do not know how to serialize a BigInt"。
 */
export function serialize(value: Rational): { n: string; d: string } {
  return { n: value.n.toString(), d: value.d.toString() };
}

/** 求和，空集合返回 0。 */
export function sum(values: readonly Rational[]): Rational {
  let acc = ZERO;
  for (const v of values) acc = add(acc, v);
  return acc;
}

/** 平均值；空集合返回 ZERO（调用方负责“—”的展示语义）。 */
export function mean(values: readonly Rational[]): Rational {
  if (values.length === 0) return ZERO;
  return div(sum(values), fromInt(values.length));
}
