/**
 * 时间录入格式（**只影响录入方便性**）。
 *
 * 现场报时习惯说「4 分 48 秒」，逐场录入时敲 `288` 容易出错，因此录入框接受：
 *
 * | 写法 | 含义 | 结果 |
 * | --- | --- | --- |
 * | `288`、`288.5`、`.5` | 秒 | `288` / `288.5` / `0.5` |
 * | `4:48`、`4：48`（全角冒号） | 分:秒 | `288` |
 * | `4:`、`:48` | 缺的一侧按 0 | `240` / `48` |
 * | `4分48秒`、`4分`、`48秒`（含空格） | 中文写法 | `288` / `240` / `48` |
 *
 * **落库、评分、排序、展示一律仍用秒**：这里只做"把录入文本换算成秒"这一件事，
 * 转换后的值是原来的十进制秒字符串，后续流程完全不变。
 *
 * 明确拒绝：负数、`1:2:3`、`4分48秒30`、字母、空串——由调用方给出可读报错，
 * 绝不把无法识别的输入当成 0（「没填」与「0 秒」是两件事）。
 */

/** 非负十进制（秒）的判定，与 event.json schema 的口径一致。 */
export const SECONDS_TEXT = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

export type DurationParse =
  | { ok: true; seconds: string }
  | { ok: false; reason: string };

/** 去掉首尾与内部空白、全角冒号归一，便于统一解析。 */
function canonical(raw: string): string {
  return raw.trim().replace(/[：]/g, ':').replace(/\s+/g, '');
}

/** 数值 → 十进制文本；去掉多余的 0 与小数点，避免 288.000000 这类噪声。 */
function secondsText(value: number): string {
  const text = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return text === '' ? '0' : text;
}

/**
 * 把录入文本换算成秒。
 *
 * 调用方负责空串（未填写）的处理——这里把空串视为无法识别。
 */
export function parseDurationInput(raw: string): DurationParse {
  const text = canonical(raw);
  if (text === '') return { ok: false, reason: '时间是空的' };

  // 1) 纯秒数（含小数）；".5" 规范成 "0.5"，避免落库出现奇怪文本
  if (SECONDS_TEXT.test(text)) return { ok: true, seconds: text.startsWith('.') ? `0${text}` : text };

  // 2) 分:秒（冒号两侧可缺一侧，"4:" 视为 240、" :48" 视为 48；只有冒号则拒绝）
  const colon = /^(\d*):((?:\d+(?:\.\d*)?|\.\d+)?)$/.exec(text);
  if (colon && (colon[1] !== '' || colon[2] !== '')) {
    const minutes = colon[1] === '' ? 0 : Number(colon[1]);
    const seconds = colon[2] === '' ? 0 : Number(colon[2]);
    return { ok: true, seconds: secondsText(minutes * 60 + seconds) };
  }

  // 3) 中文写法：4分48秒 / 4分 / 48秒（必须真的出现「分」或「秒」）
  if (text.includes('分') || text.includes('秒')) {
    const cjk = /^(?:(\d+(?:\.\d*)?|\.\d+)分)?(?:(\d+(?:\.\d*)?|\.\d+)秒)?$/.exec(text);
    if (cjk && (cjk[1] !== undefined || cjk[2] !== undefined)) {
      const minutes = cjk[1] === undefined ? 0 : Number(cjk[1]);
      const seconds = cjk[2] === undefined ? 0 : Number(cjk[2]);
      return { ok: true, seconds: secondsText(minutes * 60 + seconds) };
    }
  }

  return { ok: false, reason: '无法识别的时间写法' };
}

/** 给界面与报错共用的一句话说明。 */
export const DURATION_INPUT_HINT = '可填秒数（如 288）或「分:秒」（如 4:48），也可写「4分48秒」';
