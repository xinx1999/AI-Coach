import { getGuide } from '../lib/guide';
import { GUIDE_VERSION } from '../lib/guide/types';

interface Props {
  slug: string;
  /** compact 用于计时页速查，省略部分留白 */
  compact?: boolean;
}

/**
 * 动作教程面板：动作要领 / 呼吸 / 常见错误 / 安全提示。
 *
 * 内容来源：项目自行编写（上游素材库只有插图，没有文字教学）。
 * 因此面板底部固定标注「待专业校对」，避免用户把这当权威教材。
 */
export default function GuidePanel({ slug, compact = false }: Props) {
  const guide = getGuide(slug);

  // 没有教程时明确说明，而不是渲染一个空壳让用户以为丢内容了
  if (!guide) {
    return (
      <div className="guide-panel">
        <p className="guide-empty">这个动作还没有教程内容。</p>
      </div>
    );
  }

  return (
    <div className="guide-panel">
      <section className="guide-block">
        <p className="guide-label">动作要领</p>
        <ol className="guide-steps">
          {guide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>

      <section className="guide-block">
        <p className="guide-label">呼吸</p>
        <p className="guide-text">{guide.breathing}</p>
      </section>

      {!compact && (
        <>
          <section className="guide-block">
            <p className="guide-label">常见错误</p>
            <ul className="guide-list guide-list-warn">
              {guide.mistakes.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </section>

          <section className="guide-block">
            <p className="guide-label">安全提示</p>
            <ul className="guide-list">
              {guide.safety.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p className="guide-note">教程内容为项目自撰，待专业校对 · v{GUIDE_VERSION}</p>
    </div>
  );
}
