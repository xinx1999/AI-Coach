import { useEffect, useRef } from 'react';
import { X, Plus, Check, MapPin, Star } from 'lucide-react';
import { getAssetPath, type ClassifiedExercise } from '../lib/store';
import { exerciseName, equipmentName, muscleName, exerciseTypeName } from '../lib/zh';
import GuidePanel from './GuidePanel';

interface Props {
  exercise: ClassifiedExercise;
  alreadyAdded: boolean;
  onAdd: (ex: ClassifiedExercise) => void;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (slug: string) => void;
}

/**
 * 图注不再标注「起始 / 发力 / 结束」。
 *
 * 原因：这三帧并非同一动作的连续采样——上游 manifest 里只有 frame-1 带
 * Everkinetic 来源链接，frame-2/3 没有；且 frame-2 的路径点数是 frame-1 的
 * 1.08~4.45 倍（例如 bench-press 3532→11252），三帧两两前景重合度仅 5%~34%，
 * 说明它们是三张各自独立的插画。
 *
 * 更关键的是顺序对不上：以卧推为例，frame-1 手臂伸直（顶端/结束位）、
 * frame-2 肘弯沉胸（底端/起始位）、frame-3 又回到顶端。
 * 按「起始→发力→结束」标注与实际姿势相反，属于错误信息。
 *
 * 既然无法逐一核实每个动作的语义，就不该给出看似权威的阶段名。
 * 改为中性描述，只说这是动作的不同姿势，由用户对照自己的动作判断。
 */
const POSE_LABELS = ['姿势 1', '姿势 2', '姿势 3'] as const;

export default function ExerciseDetail({
  exercise,
  alreadyAdded,
  onAdd,
  onClose,
  isFavorite,
  onToggleFavorite,
}: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * 焦点管理：
   * 弹窗打开后把焦点移入（否则键盘用户还在背后的卡片上），
   * 并在 Tab 到边界时把焦点绕回弹窗内——没有这道「焦点陷阱」，
   * 用户可以一路 Tab 到被遮住的页面内容上，读屏软件也会念出背景内容。
   * 关闭时把焦点还给触发元素，让键盘用户不会丢失位置。
   */
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      prevFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const zhName = exerciseName(exercise.slug, exercise.name);
  const isHome = exercise.location === 'home';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${zhName} 动作详情`}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-head">
          <div>
            <h3 className="detail-title">{zhName}</h3>
            {zhName !== exercise.name && <p className="detail-sub">{exercise.name}</p>}
          </div>
          <div className="detail-head-actions">
            <button
              className={`icon-btn ${isFavorite ? 'fav-on' : ''}`}
              onClick={() => onToggleFavorite(exercise.slug)}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? '取消收藏' : '收藏'}
              title={isFavorite ? '取消收藏' : '收藏'}
            >
              <Star size={17} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="关闭" ref={closeBtnRef}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 三张动作插画并排，仅作姿势参考 */}
        <div className="pose-row">
          {([1, 2, 3] as const).map((f, i) => (
            <figure className="pose-cell" key={f}>
              <img src={getAssetPath(exercise.slug, f)} alt={`${zhName} 姿势参考 ${i + 1}`} />
              <figcaption className="pose-label">{POSE_LABELS[i]}</figcaption>
            </figure>
          ))}
        </div>

        <p className="pose-caption">
          三张图为同一动作的不同姿势，可对照检查自己的动作是否到位。
        </p>

        <div className="detail-attrs">
          <span className="detail-tag">
            <MapPin size={12} />
            {isHome ? '在家可练' : '健身房'}
          </span>
          <span className="detail-tag">{muscleName(exercise.primaryMuscle)}</span>
          <span className="detail-tag">{equipmentName(exercise.equipment)}</span>
          <span className="detail-tag">{exerciseTypeName(exercise.exerciseType)}</span>
          {exercise.isStretch && <span className="detail-tag">拉伸</span>}
        </div>

        {exercise.secondaryMuscles.length > 0 && (
          <div className="detail-section">
            <p className="detail-label">协同肌群</p>
            <p className="detail-value">
              {exercise.secondaryMuscles.map((m) => muscleName(m)).join('、')}
            </p>
          </div>
        )}

        <div className="detail-section">
          <GuidePanel slug={exercise.slug} />
        </div>

        <div className="detail-actions">
          {alreadyAdded ? (
            <button className="btn btn-secondary" disabled style={{ width: '100%' }}>
              <Check size={16} /> 已加入今日训练
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => onAdd(exercise)}
            >
              <Plus size={16} /> 加入今日训练
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
