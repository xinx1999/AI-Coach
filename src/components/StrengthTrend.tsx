import { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getStrengthTrend, getTrendCandidates, type StrengthTrend as Trend } from '../lib/store';

/** 折线图的绘图区尺寸。viewBox 固定，实际显示宽度由 CSS 撑满容器 */
const W = 560;
const H = 150;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;

/** 数值 → 屏幕坐标。min===max（只有一条水平线）时居中显示，避免除零 */
function scaleY(v: number, min: number, max: number): number {
  const span = max - min;
  const t = span === 0 ? 0.5 : (v - min) / span;
  return PAD_T + (1 - t) * (H - PAD_T - PAD_B);
}

function scaleX(i: number, count: number): number {
  if (count <= 1) return PAD_L + (W - PAD_L - PAD_R) / 2;
  return PAD_L + (i / (count - 1)) * (W - PAD_L - PAD_R);
}

/** 把点列连成折线路径 */
function linePath(values: number[], min: number, max: number): string {
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i, values.length).toFixed(1)},${scaleY(v, min, max).toFixed(1)}`)
    .join(' ');
}

/**
 * 力量趋势图。
 *
 * 存在的理由：频次图只能证明「我练了」，证明不了「我变强了」。
 * 而让用户留下来的恰恰是后者——健身房里的成就感来自数字在涨，
 * 不是来自打卡次数。所以这张图才是历史页真正的留存钩子。
 *
 * 用内联 SVG 手绘，不引图表库：只有一条折线加轴标，
 * 为一个 40KB 的依赖换 30 行代码不划算。
 */
export default function StrengthTrend() {
  const candidates = useMemo(() => getTrendCandidates(), []);
  const [slug, setSlug] = useState<string | null>(() => candidates[0]?.slug ?? null);
  /** 最大重量 / 估算 1RM 两个视角，默认 1RM——它才能反映次数带来的进步 */
  const [view, setView] = useState<'1rm' | 'weight'>('1rm');

  // 换设备导入历史后，原先选中的动作可能不再有足够数据，回落到第一个可用的
  useEffect(() => {
    if (candidates.length === 0) return;
    if (!slug || !candidates.some((c) => c.slug === slug)) {
      setSlug(candidates[0].slug);
    }
  }, [candidates, slug]);

  const trend: Trend | null = useMemo(
    () => (slug ? getStrengthTrend(slug) : null),
    [slug],
  );

  /* ---------- 空状态 ----------
     数据不足时不能藏着不显示，否则用户永远不知道这里有个趋势图、
     也就不知道「多记几次重量」能解锁它。要说清差什么。 */
  if (candidates.length === 0) {
    return (
      <div className="trend-card">
        <div className="stats-title">
          <TrendingUp size={14} /> 力量趋势
        </div>
        <p className="trend-empty">
          同一个动作记录 2 次以上带重量的训练，这里会画出力量变化的曲线。
          <br />
          训练时在「实际完成」里填上重量，就能看到它。
        </p>
      </div>
    );
  }

  if (!trend) return null;

  const use1RM = view === '1rm';
  // 缺 1RM 的点（没记次数）在 1RM 视角下跳过，不用 0 冒充
  const values = trend.points
    .map((p) => (use1RM ? p.est1RM : p.weight))
    .filter((v): v is number => v !== undefined);

  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // 上下各留一点空间，线不会贴着边框；跨度极小时给个最小高度差，避免线被压成一点
  const span = max - min;
  const pad = span === 0 ? Math.max(1, max * 0.04) : span * 0.18;
  const lo = min - pad;
  const hi = max + pad;

  const path = linePath(values, lo, hi);
  const areaPath = `${path} L${scaleX(values.length - 1, values.length).toFixed(1)},${(H - PAD_B).toFixed(1)} L${scaleX(0, values.length).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

  /**
   * 首尾差值必须跟着当前视角算。
   *
   * store 里的 trend.delta 是 1RM 口径的，如果直接拿来显示，
   * 切到「最大重量」时会出现「重量明明是平的，却显示 +14kg」这种自相矛盾。
   * 同一个数字在两个视角下含义不同，就必须分别计算。
   */
  const delta = (() => {
    if (values.length < 2) return null;
    const d = Math.round((values[values.length - 1] - values[0]) * 10) / 10;
    return d;
  })();
  const deltaLabel = delta === null ? null : `${delta > 0 ? '+' : ''}${delta}kg`;

  /**
   * 「最好成绩」也要跟着视角走。
   *
   * 1RM 视角下展示 trend.best（store 按 1RM 挑出来的那个点）没问题；
   * 但切到「最大重量」时若仍显示它的 1RM，用户会看到一串和曲线对不上的数字。
   * 所以这里按当前值序列自己挑最大值，保证读数与图形永远一致。
   */
  const viewBest = (() => {
    const peak = Math.max(...values);
    const idx = values.indexOf(peak);
    const point = trend.points.filter((p) => (use1RM ? p.est1RM : p.weight) !== undefined)[idx];
    return { value: peak, reps: point?.reps };
  })();

  return (
    <div className="trend-card">
      <div className="trend-head">
        <span className="stats-title" style={{ marginBottom: 0 }}>
          <TrendingUp size={14} /> 力量趋势
        </span>

        {/* 视角切换。放在右上而不是下方，是为了不打断从标题到曲线的阅读顺序 */}
        <div className="trend-toggle" role="group" aria-label="趋势指标">
          <button
            className={`trend-toggle-btn ${use1RM ? 'on' : ''}`}
            onClick={() => setView('1rm')}
            title="把不同次数的组换算到同一尺度，反映真实力量增长"
          >
            估算 1RM
          </button>
          <button
            className={`trend-toggle-btn ${!use1RM ? 'on' : ''}`}
            onClick={() => setView('weight')}
            title="每次训练实际推起的最大重量"
          >
            最大重量
          </button>
        </div>
      </div>

      {/* 动作选择：横向滚动，动作多时不会把卡片撑高 */}
      <div className="trend-picker">
        {candidates.map((c) => (
          <button
            key={c.slug}
            className={`trend-chip ${c.slug === slug ? 'on' : ''}`}
            onClick={() => setSlug(c.slug)}
            title={`${c.count} 次训练有记录`}
          >
            {c.name}
            <span className="trend-chip-count">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="trend-summary">
        <span className="trend-best">
          {use1RM ? '最好' : '最重'}{' '}
          <strong>{viewBest.value}kg</strong>
          {viewBest.reps ? ` × ${viewBest.reps}` : ''}
        </span>
        {deltaLabel && (
          <span className={`trend-delta ${delta! > 0 ? 'up' : delta! < 0 ? 'down' : 'flat'}`}>
            {delta! > 0 ? <TrendingUp size={13} /> : delta! < 0 ? <TrendingDown size={13} /> : <Minus size={13} />}
            {deltaLabel}
            <span className="trend-delta-note">较首次</span>
          </span>
        )}
        <span className="trend-count">{trend.points.length} 次记录</span>
      </div>

      <svg
        className="trend-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${trend.name} 的力量趋势，共 ${trend.points.length} 个数据点`}
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 横向基准线：最高与最低值，给曲线一个可读的尺度 */}
        <g className="trend-grid">
          <line x1={PAD_L} y1={scaleY(max, lo, hi)} x2={W - PAD_R} y2={scaleY(max, lo, hi)} />
          <line x1={PAD_L} y1={scaleY(min, lo, hi)} x2={W - PAD_R} y2={scaleY(min, lo, hi)} />
        </g>

        {/* 轴标放右端，避免和左侧起点重叠 */}
        <text className="trend-axis" x={PAD_L - 6} y={scaleY(max, lo, hi) + 3} textAnchor="end">
          {Math.round(max)}
        </text>
        <text className="trend-axis" x={PAD_L - 6} y={scaleY(min, lo, hi) + 3} textAnchor="end">
          {Math.round(min)}
        </text>

        <path d={areaPath} fill="url(#trendFill)" />
        <path className="trend-line" d={path} />

        {values.map((v, i) => (
          <circle
            key={i}
            className="trend-dot"
            cx={scaleX(i, values.length)}
            cy={scaleY(v, lo, hi)}
            r={values.length > 30 ? 2 : 3.2}
          >
            <title>{`${new Date(trend.points[i]?.at ?? '').toLocaleDateString('zh-CN')}：${v}kg`}</title>
          </circle>
        ))}
      </svg>

      <div className="trend-foot">
        <span>{new Date(trend.points[0].at).toLocaleDateString('zh-CN')}</span>
        <span className="trend-foot-hint">
          {use1RM ? 'Epley 公式估算，仅供横向比较' : '每次训练的最重一组'}
        </span>
        <span>{new Date(trend.points[trend.points.length - 1].at).toLocaleDateString('zh-CN')}</span>
      </div>
    </div>
  );
}
