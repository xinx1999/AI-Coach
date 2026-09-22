import { useSyncExternalStore } from 'react';
import { Activity, AlertTriangle, Wind } from 'lucide-react';
import { getExercise } from '../lib/store';
import { COACHING_DISCLAIMER, coachingFor } from '../lib/coaching';
import { EMPTY_STEPS, stepsFor, subscribeSteps } from '../lib/steps';

interface Props {
  slug: string;
  /** 紧凑模式：只列步骤，用于计时页的速查 */
  compact?: boolean;
  /**
   * 步骤是否已由别处呈现（详情页的播放器里有一份可点击的步骤列表）。
   *
   * 播放器把「步骤」和「画面帧」绑在一起，那里的步骤是可交互的；
   * 这里再列一遍纯文本就是重复内容，用户要滚两遍同样的字。
   * 所以详情页传 true，本组件只补充呼吸和错误两块；
   * 计时页的折叠区没有播放器步骤，传 false 正常显示。
   */
  stepsHandled?: boolean;
}

/**
 * 动作要领。
 *
 * 三块内容，按「看动作时需要的顺序」排：
 *   1. 分步说明 —— 数据集的 `instruction_steps.zh`，人工撰写，这部分是原始素材
 *   2. 呼吸节奏 —— 数据集里只有 11% 的动作有，其余按向心呼气/离心吸气的通用原则生成
 *   3. 常见错误 —— 数据集里基本没有（0.8%），按动作特征生成
 *
 * 后两块由 lib/coaching.ts 生成，理由和依据都写在那个文件顶部。
 * 这里负责呈现，不做判断。
 */
export default function GuidePanel({ slug, compact = false, stepsHandled = false }: Props) {
  const ex = getExercise(slug);

  // 步骤不在 catalog 里了（见 lib/steps.ts），要订阅异步加载完成才会重渲染。
  // hook 不能放在下面的 early return 之后，所以这里先算好。
  const steps = useSyncExternalStore(
    subscribeSteps,
    () => (ex ? stepsFor(ex.id) : EMPTY_STEPS),
    () => EMPTY_STEPS, // SSR 快照
  );

  if (!ex) return null;

  const tip = coachingFor(ex);
  const hasSteps = steps.length > 0;
  /** 步骤由外部呈现时，这里不再重复列 */
  const showSteps = !stepsHandled;

  // 没有分步说明就没有要领可展示。
  // 原先这里还有 `|| ex.instructions` 兜底，但实测 1318/1318 条都有 steps，
  // 那个兜底从未触发过，随 instructions 字段一并删除。
  if (!hasSteps) return null;

  return (
    <section className={`guide ${compact ? 'guide-compact' : ''}`}>
      {showSteps && (
        <>
          <div className="guide-head">
            <h3 className="guide-title">
              <Activity size={12} /> 动作要领
            </h3>
          </div>

          {/* 能走到这里说明 hasSteps 必为 true（上面已 return null） */}
          <ol className="guide-steps">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}

      {/* 步骤由播放器承担时，这里还需要一个标题，否则整块内容没有上下文 */}
      {!showSteps && (
        <div className="guide-head">
          <h3 className="guide-title">
            <Activity size={12} /> 动作要领
          </h3>
        </div>
      )}

      {tip.breathing && (
        <div className="guide-block">
          <div className="guide-block-head">
            <Wind size={13} />
            呼吸节奏
          </div>
          <p className="guide-block-text">{tip.breathing}</p>
        </div>
      )}

      {tip.mistakes.length > 0 && (
        <div className="guide-block guide-block-warn">
          <div className="guide-block-head">
            <AlertTriangle size={13} />
            常见错误
          </div>
          <ul className="guide-mistakes">
            {tip.mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 免责说明必须跟着这两块生成内容一起出现，不能只在某个角落提一次 */}
      {!compact && <p className="guide-note">{COACHING_DISCLAIMER}</p>}
    </section>
  );
}
