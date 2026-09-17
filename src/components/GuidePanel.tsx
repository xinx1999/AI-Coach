import { getExercise, displayName } from '../lib/store';
import type { Exercise } from '../lib/types';

interface Props {
  slug: string;
  /** 紧凑模式：只列步骤，用于计时页的速查 */
  compact?: boolean;
}

/**
 * 动作要领。
 *
 * 文案直接来自数据集自带的 `instruction_steps.zh`（人工撰写的中文分步说明），
 * 不再由本项目自撰 —— 之前那版 302 条自写教程既不可信、也没必要，
 * 数据集本来就有更完整的中文内容。
 */
export default function GuidePanel({ slug, compact = false }: Props) {
  const ex = getExercise(slug);
  if (!ex) return null;

  const steps = ex.steps ?? [];
  if (steps.length === 0 && !ex.instructions) return null;

  return (
    <section className={`guide ${compact ? 'guide-compact' : ''}`}>
      <div className="guide-head">
        <h3 className="guide-title">动作要领</h3>
        {/* 非紧凑模式下动作名已在弹窗标题里出现过，这里不再重复；
            紧凑模式（计时页速查）没有标题，才需要带上名字 */}
        {compact && <span className="guide-src">{displayName(ex)}</span>}
      </div>

      {steps.length > 0 ? (
        <ol className="guide-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : (
        <p className="guide-text">{ex.instructions}</p>
      )}
    </section>
  );
}

/** 供其他组件直接取步骤，避免各自重复实现 */
export function stepsOf(ex: Exercise): string[] {
  return ex.steps ?? [];
}
