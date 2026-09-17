import { useEffect, useRef, useState } from 'react';
import { X, Plus, Check, Play, Pause, MapPin } from 'lucide-react';
import { getAssetPath, type ClassifiedExercise } from '../lib/store';
import { exerciseName, equipmentName, muscleName, exerciseTypeName } from '../lib/zh';

interface Props {
  exercise: ClassifiedExercise;
  alreadyAdded: boolean;
  onAdd: (ex: ClassifiedExercise) => void;
  onClose: () => void;
}

const FRAME_MS = 900; // 每帧停留时长，太快看不清动作，太慢显得卡

/**
 * 三帧循环动画。
 * 先把三张图 new Image() 预加载，全部 onload 后再开始轮播，
 * 否则第一轮切换时会出现空白闪烁。
 */
function useFrameAnimation(slug: string, playing: boolean) {
  const [frame, setFrame] = useState<1 | 2 | 3>(1);
  const [ready, setReady] = useState(false);

  // 预加载
  useEffect(() => {
    let alive = true;
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

  // 轮播
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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 打开时禁止背景滚动
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
        ref={dialogRef}
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

        {/* ---- 动画演示区 ---- */}
        <div className="demo-stage">
          <img
            className="demo-frame"
            src={getAssetPath(exercise.slug, frame)}
            alt={`${zhName} 动作演示 第 ${frame} 帧`}
          />

          {/* 帧指示点 */}
          <div className="demo-dots" role="tablist" aria-label="动作帧">
            {([1, 2, 3] as const).map((f) => (
              <span key={f} className={`demo-dot ${frame === f ? 'on' : ''}`} aria-hidden="true" />
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
          {playing
            ? '正在循环演示动作的三个关键帧'
            : '已暂停，可点击播放继续观看'}
        </p>

        {/* ---- 属性 ---- */}
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

        {/* ---- 操作 ---- */}
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
