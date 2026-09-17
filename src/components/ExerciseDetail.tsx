import { useEffect, useState } from 'react';
import { X, Plus, Check, Play, Pause, MapPin } from 'lucide-react';
import { getAssetPath, type ClassifiedExercise } from '../lib/store';
import { exerciseName, equipmentName, muscleName, exerciseTypeName } from '../lib/zh';

interface Props {
  exercise: ClassifiedExercise;
  alreadyAdded: boolean;
  onAdd: (ex: ClassifiedExercise) => void;
  onClose: () => void;
}

const FRAME_MS = 1100; // 每帧停留时长

/**
 * 三帧循环动画。
 *
 * 做法上有个关键点：三张图**同时叠放在 DOM 里**，靠 CSS opacity 交叉淡入淡出切换，
 * 而不是替换 <img src>。原因是替换 src 会产生硬切换（瞬间跳帧），
 * 视觉上像幻灯片翻页；叠放 + opacity 过渡则是渐变，观感接近真实运动。
 * 这样第 3 帧回到第 1 帧同样是渐变，不会在循环接缝处出现突兀的跳变。
 *
 * 另外先把三张图全部预加载完成再开始播放，否则首轮切换会因未解码而闪白。
 */
function useFrameAnimation(slug: string, playing: boolean) {
  const [frame, setFrame] = useState<1 | 2 | 3>(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setFrame(1);
    const imgs = ([1, 2, 3] as const).map((f) => {
      const img = new Image();
      img.src = getAssetPath(slug, f);
      return img;
    });
    Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((res) => {
            if (img.complete) return res();
            img.onload = () => res();
            img.onerror = () => res();
          }),
      ),
    ).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!playing || !ready) return;
    const t = setInterval(() => {
      setFrame((f) => (f === 1 ? 2 : f === 2 ? 3 : 1));
    }, FRAME_MS);
    return () => clearInterval(t);
  }, [playing, ready]);

  return { frame, ready };
}

export default function ExerciseDetail({ exercise, alreadyAdded, onAdd, onClose }: Props) {
  const [playing, setPlaying] = useState(true);
  const { frame, ready } = useFrameAnimation(exercise.slug, playing);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-head">
          <div>
            <h3 className="detail-title">{zhName}</h3>
            {zhName !== exercise.name && <p className="detail-sub">{exercise.name}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {/* ---- 动画演示区：三帧叠放，opacity 交叉淡入淡出 ---- */}
        <div className="demo-stage">
          <div className="demo-stack">
            {([1, 2, 3] as const).map((f) => (
              <img
                key={f}
                className={`demo-layer ${frame === f && ready ? 'visible' : ''}`}
                src={getAssetPath(exercise.slug, f)}
                alt={f === 1 ? `${zhName} 动作演示` : ''}
                aria-hidden={f === 1 ? undefined : true}
              />
            ))}
          </div>

          <div className="demo-dots" aria-hidden="true">
            {([1, 2, 3] as const).map((f) => (
              <span key={f} className={`demo-dot ${frame === f ? 'on' : ''}`} />
            ))}
          </div>

          <button
            className="demo-toggle"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? '暂停演示' : '播放演示'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? '暂停' : '播放'}
          </button>

          {!ready && <div className="demo-loading">加载中…</div>}
        </div>

        <p className="demo-caption">
          {playing ? '循环演示动作的三个关键帧' : '已暂停，点击播放继续观看'}
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
