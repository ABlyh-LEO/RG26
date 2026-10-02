/**
 * 规则页：排名如何计算，时间是否准确。
 *
 * 内容与 docs/RULES.md 对应；公式与 DOCX 的 OMML 一致。
 */
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useData } from '../data/DataProvider';
import { formatDate } from '../data/view-model';
import { Icon } from '../components/Icon';

export function RulesPage() {
  const { derived } = useData();
  const location = useLocation();
  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section');
    if (!section) return;
    const frame = requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [location.search]);

  const rulesVersion = derived?.event.rules.version ?? '—';
  const sourceSha = derived?.event.event.sourceDocumentSha256 ?? '—';
  const updatedAt = derived?.event.event.contentUpdatedAt ?? null;
  const openItems = derived?.event.event.openItems ?? [];

  return (
    <div className="stack reference-page" style={{ gap: 'var(--sp-4)' }}>
      <div className="page-head">
        <div className="eyebrow">COMPETITION GUIDE</div>
        <h1 className="page-head__title">规则与说明</h1>
        <p className="page-head__sub">
          从第一轮到冠军，了解比赛怎么打、成绩怎么算。
        </p>
      </div>
      <div className="reference-intro"><h2>先看懂比赛，再看懂每一分。</h2><p>排位赛取两轮最优成绩，前十六名进入瑞士轮。瑞士轮三胜晋级、三败止步，八强通过双败赛与 BO3 决出冠军。</p></div>
      <nav className="rules-contents" aria-label="规则目录">{[['format', '赛制'], ['scoring', '评分公式'], ['pairing', '排序配对'], ['confirmation', '判定与确认'], ['finals', '八强与名次'], ['sources', '资料来源']].map(([id, label]) => <Link key={id} to={`/rules?section=${id}`}>{label}</Link>)}</nav>

      <div className="card rules-section" id="time">
        <div className="card__head">
          <span className="card__title">时间是否准确</span>
        </div>
        <p className="small">
          本页时间来自赛前计划表，<strong>仅供参考</strong>。原文明确说明：具体情况以赛程组共享文档当天安排为准。
          现场调整会以公告形式更新。
        </p>
        <p className="xsmall muted">
          所有时间均按赛事时区（Asia/Shanghai）显示，不随访问者所在时区变化。
          页面不会因为时间已过就自动把比赛标为“正在进行”或“已结束”。
        </p>
      </div>

      <div className="card rules-section" id="format">
        <div className="card__head">
          <span className="card__title">赛制总览</span>
        </div>
        <ol className="stack stack--tight small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>
            <strong>排位赛</strong>：22 支竞技组队伍按三审排名顺序各跑两轮（上午、下午各一轮，两场地并行），
            取两轮中最优成绩排出第 1–22 名。前 16 名晋级十六强，第 17–22 名结算优秀奖。
          </li>
          <li>
            <strong>瑞士轮（十六进八）</strong>：最多五轮 BO1，每场须决出胜负。
            累计三胜晋级八强，累计三败淘汰；达到三胜或三败后停止参赛。五轮依次 8、8、8、6、3 场，共 33 场。
          </li>
          <li>
            <strong>八强双败赛</strong>：八强种子先进行 1 对 5、2 对 6、3 对 7、4 对 8 四场首轮比赛，
            胜者进入胜者组、败者进入败者组。竞技决赛共 12 场 BO1，
            再由“总决赛名额争夺战”与“总决赛”两组 BO3 决出冠军。
          </li>
          <li>
            <strong>表演赛</strong>：总决赛结束后根据现场情况安排 15 分钟 BO2，不计正式排名。
          </li>
        </ol>
      </div>

      <div className="card rules-section" id="scoring">
        <div className="card__head">
          <span className="card__title">瑞士轮评分公式</span>
        </div>
        <p className="small">
          配对采用截至上一完整轮次已确认的数据；最终排名采用第五轮结束后的数据。
          统计全部有效瑞士轮比赛，包含胜局、败局及按规则提前结束的场次；重赛只取最终有效场次。
        </p>

        <FormulaBlock
          title="每场统计量"
          lines={[
            'n  = 计入得分表现的有效比赛数量',
            'm  = 已结算并登记的对阵数量（含未开赛弃权与行政判负中止）',
            's_k = 第 k 场本队最终有效原始积分（不封顶）',
            'o_k = 第 k 场对手最终有效原始积分',
            'd_k = s_k − o_k',
            't_k = 开赛后首次达到本局最终有效积分的时间（秒）；零分局记 360 秒',
          ]}
        />

        <FormulaBlock
          title="局均指标"
          lines={['局均得分 = Σs_k / n', '局均分差 = Σd_k / n', 'T = Σt_k / n']}
        />

        <FormulaBlock
          title="得分表现 A、分差表现 B、表现分 P"
          lines={[
            'A = (100 / n) × Σ( min(s_k, 16) / 16 )',
            'B = (1 / n) × Σ( 50 + 5 × clamp(s_k − o_k, −10, +10) )',
            'P = (A + B) / 2',
          ]}
          note="各场得分先按 16 分封顶，分差先限制在 −10 至 +10，再换算为百分制并取平均。原始积分与原始均值保留不封顶的真实值。"
        />

        <FormulaBlock
          title="对手强度分 O、综合分 R"
          lines={[
            'v_j = W_j / (W_j + L_j)     （无胜负记录时 v 记 0）',
            'q_j = 50 × v_j + 0.5 × P_j',
            'O   = (1 / m) × Σ q_j        （按每场对应对手计入一次）',
            'R   = 0.6 × P + 0.4 × O',
          ]}
          note="先计算所有队伍的 P 与 v，再计算 O、R。O 不依赖对手的 O 或 R。与同一对手多次对阵就按每场分别计入，不把对手集合去重。"
        />

        <p className="small">
          A、B、P、O、R 均为 0 至 100 分。边界值：n = 0 时 A、B、P 记 0、T 记 360 秒；
          无胜负记录时 v 记 0；m = 0 时 O 记 0。局均得分与局均分差在 n = 0 时显示“—”，原文没有规定其默认值。
        </p>
      </div>

      <div className="card rules-section" id="pairing">
        <div className="card__head">
          <span className="card__title">同战绩组排序与配对</span>
        </div>
        <p className="small">
          同战绩组依次比较：<strong>R 高者 → P 高者 → T 小者 → 排位赛名次靠前者</strong>；前项相同才比较后项。
          按原始精度排序，公布时保留两位小数。页面显示的四舍五入值不参与排序。
        </p>
        <p className="small">
          第一轮按排位赛名次<strong>分为前后两半对位</strong>（第 1 名对第 9 名、第 2 名对第 10 名，依此类推，直至第 8 名对第 16 名）。
          第二轮起按相同胜负战绩分组，组内按上述规则排序后<strong>首尾配对</strong>（第 1 名对末名、第 2 名对倒数第 2 名，依此类推）。
        </p>
        <p className="xsmall muted">
          原文没有“避免重复对阵”的规定，因此本工具不实现自动避重、跨组调队、随机配对或轮空规则。
        </p>
      </div>

      <div className="card rules-section" id="confirmation">
        <div className="card__head">
          <span className="card__title">异常与成绩确认</span>
        </div>
        <ul className="stack stack--tight small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>按照竞技组规则手册 4_6，先比较最终积分（保底分与最高建筑总分）；积分相同时，先达到该积分者优先。</li>
          <li>双方均未完成搭建时比较先抓取情况；零分局由裁判与组委会确认结果。</li>
          <li>大胜条件为达到 14 分、领先 10 分以上并持续 10 秒。页面只呈现已确认结果，不据录入积分自行判罚。</li>
          <li>
            有效正常比赛、按规则提前结束的有效比赛：双方计入表现统计、战绩与 O。
          </li>
          <li>
            未开赛的弃权局及行政判负中止场次：双方均不计入 A、B、P、T，
            但胜负及已登记对阵仍计入战绩和 O。
          </li>
          <li>有效比赛缺少积分时不按 0 分处理；缺分不等于 0，不得用假 0 分填补缺失数据。</li>
          <li>重赛只纳入最后有效的那一次；旧记录保留并标记为被取代。</li>
          <li>瑞士轮每场必须有明确胜者，不允许平局；胜者由裁判确认，不根据积分高低自动推断。</li>
        </ul>
      </div>

      <div className="card rules-section" id="finals">
        <div className="card__head">
          <span className="card__title">八强种子与名次结算</span>
        </div>
        <p className="small">
          瑞士轮最终战绩组顺序为 3-0、3-1、3-2、2-3、1-3、0-3，正常队数分别为 2、3、3、3、3、2。
          同组排名使用第五轮结算后的数据。
        </p>
        <ul className="stack stack--tight small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>3-0 组两队为八强种子第 1、2 名</li>
          <li>3-1 组三队为八强种子第 3、4、5 名</li>
          <li>3-2 组三队为八强种子第 6、7、8 名</li>
        </ul>
        <p className="small" style={{ marginTop: 'var(--sp-2)' }}>
          10 月 4 日上午的四场八强首轮按 1 对 5、2 对 6、3 对 7、4 对 8 配对。
          下午胜者组与败者组的参赛队伍来自上午首轮的胜负结果，后续对阵按固定晋级图进行。
        </p>
        <p className="small">
          已晋级、已淘汰队伍的胜率和 P 按实际已赛成绩保留，其 O 随历史对手成绩更新。
          因此两支 3-0 队伍不能在第三轮当晚就永久确定第 1、2 种子，最终种子要等第五轮全部结束后统一计算。
        </p>
        <p className="small">
          <strong>决赛红蓝方：BO1、BO3 均不换边。</strong>第一席位为蓝方，第二席位为红方；
          BO3 第 1、2、3 局保持相同归属，先赢 2 局结束，2:0 后第 3 局无需进行。
          瑞士轮仍按轮次分配：奇数轮第一席位蓝、第二席位红，偶数轮相反。
        </p>
        <p className="xsmall muted">
          名次结算：八强败者组首轮与第二轮的败者结算“八强”；半决赛败者组败者结算“四强”；
          名额争夺战败者为季军；总决赛败者为亚军、胜者为冠军。
          并列的八强不编造精确第 5–8 名。
        </p>
      </div>

      <div className="card rules-section" id="sources">
        <div className="card__head">
          <span className="card__title">数据来源与已知未明确项</span>
        </div>
        <div className="stack stack--tight small">
          <p><Icon name="book" size={16} /> <strong>赛程依据</strong>：RoboGame2026赛程安排（暂定） (1).docx</p>
          <p><strong>竞技规则</strong>：RoboGame2026 竞技组规则手册4_6.pdf（2026 年 10 月 1 日发布），比赛胜负条件见第 23 页。</p>
          <p className="muted">规则版本 {rulesVersion}。上述资料由组委会提供，现场最终解释与确认优先。</p>
          <details className="disclosure"><summary>查看数据来源校验信息</summary><div>
            <span className="muted">原始文档 SHA256：</span>
            <code className="xsmall" style={{ overflowWrap: 'anywhere' }}>
              {sourceSha}
            </code>
          </div></details>
          {updatedAt ? (
            <div>
              <span className="muted">数据更新时间：</span>
              {formatDate(updatedAt)}
            </div>
          ) : null}
        </div>

        <p className="small" style={{ marginTop: 'var(--sp-3)' }}>
          排位赛名次口径（<strong>已由组委会确认</strong>）：
        </p>
        <ul className="stack stack--tight small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>
            <strong>积分高者优；积分相同时，到达最终分时间早者优。</strong>
            每队取两轮中最优的一轮参与比较，两名次表与原始成绩一起公开。
          </li>
          <li>
            积分与用时完全相同的并列无法由数据区分，工具会标出「并列」并保留原顺序，
            需人工复核。
          </li>
        </ul>

        <p className="small" style={{ marginTop: 'var(--sp-3)' }}>
          以下内容原文仍未明确，本工具采用安全默认，<strong>不自行推测</strong>：
        </p>
        <ul className="stack stack--tight small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>原始成绩的结构：允许保存结果文字与可选积分/用时；文字仅作展示，名次只用积分与用时。</li>
          <li>“已登记对阵”的口径：按已经确认结果的有效对阵计入；下一轮仅公布但尚未完赛的配对不提前计入 O。</li>
          <li>时间字段的总范围：大于 360 秒只提示复核，不据此新增硬性判罚。</li>
        </ul>

        {openItems.length > 0 ? (
          <>
            <p className="small" style={{ marginTop: 'var(--sp-3)' }}>
              仍待补齐的资料：
            </p>
            <ul className="stack stack--tight small" style={{ paddingLeft: '1.2em', margin: 0 }}>
              {openItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

function FormulaBlock({ title, lines, note }: { title: string; lines: string[]; note?: string }) {
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div className="small" style={{ fontWeight: 700, marginBottom: 'var(--sp-1)' }}>
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 'var(--sp-3)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          overflowX: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          lineHeight: 1.7,
        }}
      >
        {lines.join('\n')}
      </pre>
      {note ? (
        <p className="xsmall muted" style={{ marginTop: 'var(--sp-1)' }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
