import { useEffect, useRef, useSyncExternalStore } from 'react';
import { X, Plus, Check, Home, Dumbbell, Star, Heart, Repeat, Timer, Route, Target } from 'lucide-react';
import { gifPath, thumbPath, displayName, type ClassifiedExercise } from '../lib/store';
import { EMPTY_STEPS, stepsFor, subscribeSteps } from '../lib/steps';
import ExercisePlayer from './ExercisePlayer';
import GuidePanel from './GuidePanel';

interface Props {
  exercise: ClassifiedExercise;
  alreadyAdded: boolean;
  onAdd: (ex: ClassifiedExercise) => void;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (slug: string) => void;
}

const METRIC_LABEL: Record<string, string> = {
  reps: '按次数',
  duration: '按时间',
  distance: '按距离',
};

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

  // 分步说明不在 catalog 里，要订阅异步加载完成（见 lib/steps.ts）。
  // 未加载完时返回稳定的空数组，播放器对空步骤已有守卫（steps.length > 0）。
  const steps = useSyncExternalStore(
    subscribeSteps,
    () => stepsFor(exercise.slug),
    () => EMPTY_STEPS, // SSR 快照
  );

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

  const zhName = displayName(exercise);
  const isHome = exercise.location === 'home';
  const gif = gifPath(exercise);
  const thumb = thumbPath(exercise);

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
        {/* 演示区。见 ExercisePlayer —— 剔掉定格帧 + 整体放慢 2 倍。
            刻意是零交互的：没有控制条，步骤列表也不可点。
            浮层控件（标签、收藏、关闭）仍压在图上，所以播放器放在下层容器里。 */}
        <div className="demo">
          <div className="demo-player-wrap">
            <ExercisePlayer
              gifSrc={gif}
              thumbSrc={thumb}
              alt={zhName}
              steps={steps}
            />
          </div>

          <div className="demo-overlay">
            <div className="demo-tags">
              <span className={`tag tag-solid ${isHome ? 'tag-home-solid' : 'tag-gym-solid'}`}>
                {isHome ? <Home size={12} /> : <Dumbbell size={12} />}
                {isHome ? '在家' : '健身房'}
              </span>
              {exercise.stretch && (
                <span className="tag">
                  <Heart size={12} /> 拉伸
                </span>
              )}
            </div>
            <div className="detail-head-actions">
              <button
                className={`icon-btn icon-btn-glass ${isFavorite ? 'fav-on' : ''}`}
                onClick={() => onToggleFavorite(exercise.slug)}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? '取消收藏' : '收藏'}
                title={isFavorite ? '取消收藏' : '收藏'}
              >
                <Star size={17} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
              <button
                className="icon-btn icon-btn-glass"
                onClick={onClose}
                aria-label="关闭"
                ref={closeBtnRef}
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="detail-body">
          {/* 标题区：中文名 + 英文原名并排，省掉一行单独的斜体小字 */}
          <div className="detail-heading">
            <h3 className="detail-title">{zhName}</h3>
            {zhName !== exercise.name && <span className="detail-sub">{exercise.name}</span>}
          </div>

          {/* 属性统一成一行 chips。原先「主练/协同/器械」在底部又来一遍，
              与这里的标签重复，现已合并到这一处。 */}
          <div className="detail-attrs">
            <span className="detail-tag detail-tag-key">
              <Target size={12} />
              {exercise.targetZh || exercise.target}
            </span>
            {exercise.equipmentZh && <span className="detail-tag">{exercise.equipmentZh}</span>}
            {exercise.bodyPartZh && <span className="detail-tag">{exercise.bodyPartZh}</span>}
            <span className="detail-tag detail-tag-metric">
              {exercise.metric === 'distance' ? (
                <Route size={12} />
              ) : exercise.metric === 'duration' ? (
                <Timer size={12} />
              ) : (
                <Repeat size={12} />
              )}
              {METRIC_LABEL[exercise.metric]}
            </span>
          </div>

          {exercise.secondary.length > 0 && (
            <div className="detail-secondary">
              <span className="detail-secondary-label">协同</span>
              <span className="detail-secondary-value">
                {exercise.secondary.map((m) => m.zh || m.en).join('、')}
              </span>
            </div>
          )}

          {/* 步骤已由上面的播放器以可点击的形式呈现，这里不再重复列一遍纯文本 */}
          <GuidePanel slug={exercise.slug} stepsHandled />

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
    </div>
  );
}
