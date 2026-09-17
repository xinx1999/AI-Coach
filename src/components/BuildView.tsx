import { useState, useCallback, useMemo } from 'react';
import {
  Trash2,
  Plus,
  Dumbbell,
  Check,
  Play,
  CirclePlay,
  ChevronUp,
  ChevronDown,
  Clock,
  Star,
} from 'lucide-react';
import {
  allExercises,
  getAssetPath,
  updateSet,
  addSet,
  removeSet,
  countSets,
  metricSpecFor,
  estimateWorkoutSeconds,
  getLastPerformance,
  formatLastPerformance,
} from '../lib/store';
import { exerciseName, equipmentName, muscleName } from '../lib/zh';
import type { WorkoutExercise, WorkoutSession } from '../lib/types';

interface Props {
  workout: WorkoutExercise[];
  onUpdate: (w: WorkoutExercise[]) => void;
  onStartWorkout: () => void;
  notes: string;
  onNotesChange: (v: string) => void;
  session: WorkoutSession | null;
  onResumeSession: () => void;
  /** 收藏的 slug 列表，用于「只看收藏」快速取用 */
  favorites: string[];
  onToggleFavorite: (slug: string) => void;
}

/** 把秒数说成人话 */
function humanDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `约 ${min} 分钟`;
  const h = Math.floor(min / 60);
  return `约 ${h} 小时 ${min % 60} 分`;
}

export default function BuildView({
  workout,
  onUpdate,
  onStartWorkout,
  notes,
  onNotesChange,
  session,
  onResumeSession,
  favorites,
  onToggleFavorite,
}: Props) {
  const [quickCount, setQuickCount] = useState(12);
  const [quickOnlyFav, setQuickOnlyFav] = useState(false);

  const totalSets = useMemo(() => countSets(workout), [workout]);

  /**
   * 预估时长与实际组内容挂钩，所以要在组数/时长变化时重算。
   * 用训练中常见的 60 秒组间休息作为默认值。
   */
  const estimated = useMemo(() => estimateWorkoutSeconds(workout, 60), [workout]);

  const patchExercise = useCallback(
    (index: number, next: WorkoutExercise) => {
      onUpdate(workout.map((w, i) => (i === index ? next : w)));
    },
    [workout, onUpdate],
  );

  /** 上移 / 下移：动作顺序影响训练节奏（大肌群复合动作该在前面） */
  const move = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= workout.length) return;
      const next = [...workout];
      [next[index], next[target]] = [next[target], next[index]];
      onUpdate(next);
    },
    [workout, onUpdate],
  );

  const addExercise = useCallback(
    (slug: string) => {
      const ex = allExercises.find((e) => e.slug === slug);
      if (!ex || workout.some((w) => w.slug === slug)) return;
      const id = () => Math.random().toString(36).slice(2, 8);
      onUpdate([
        ...workout,
        {
          exercise: ex,
          slug,
          sets: [1, 2, 3].map((n) => ({ id: id(), setNumber: n, completed: false })),
        },
      ]);
    },
    [workout, onUpdate],
  );

  const removeExercise = useCallback(
    (index: number) => onUpdate(workout.filter((_, i) => i !== index)),
    [workout, onUpdate],
  );

  const updateSetField = useCallback(
    (
      index: number,
      setId: string,
      field: 'reps' | 'weight' | 'durationSec' | 'distanceM',
      value: number | undefined,
    ) => {
      const w = workout[index];
      if (!w) return;
      patchExercise(index, updateSet(w, setId, { [field]: value }));
    },
    [workout, patchExercise],
  );

  /** 勾选状态可切换，勾错了能取消 */
  const toggleSet = useCallback(
    (index: number, setId: string) => {
      const w = workout[index];
      if (!w) return;
      const target = w.sets.find((s) => s.id === setId);
      if (!target) return;
      patchExercise(
        index,
        updateSet(w, setId, {
          completed: !target.completed,
          completedAt: !target.completed ? new Date().toISOString() : undefined,
        }),
      );
    },
    [workout, patchExercise],
  );

  const handleStart = () => {
    if (workout.length === 0) return;
    onStartWorkout();
  };

  const quickPool = useMemo(() => {
    const notAdded = allExercises.filter((e) => !workout.some((w) => w.slug === e.slug));
    return quickOnlyFav ? notAdded.filter((e) => favorites.includes(e.slug)) : notAdded;
  }, [workout, favorites, quickOnlyFav]);

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* 有进行中的训练时给出恢复入口，避免用户误以为要先重新开始 */}
      {session && (
        <div className="resume-banner">
          <CirclePlay size={16} />
          <span>有一次进行中的训练（{session.exercises.length} 个动作）</span>
          <button className="btn btn-primary" onClick={onResumeSession}>
            继续训练
          </button>
        </div>
      )}

      <div className="section-row">
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>今日训练</h2>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {workout.length} 个动作 · {totalSets} 组
          {workout.length > 0 && (
            <>
              {' · '}
              <Clock size={11} style={{ verticalAlign: -1, marginRight: 2 }} />
              {humanDuration(estimated)}
            </>
          )}
        </span>
      </div>

      {workout.length === 0 ? (
        <div className="empty-state">
          <Dumbbell size={40} color="var(--text-muted)" />
          <h3>还没有安排动作</h3>
          <p>从下方快速添加，或去「浏览」页面按肌群挑选。</p>
        </div>
      ) : (
        <div className="workout-list">
          {workout.map((w, index) => {
            /**
             * 按动作类型决定要填什么。
             * 之前对所有类型都渲染「次 + kg」，编排跑步时会看到要填 kg——
             * 上游的 exerciseType 就是为这件事准备的，不该只用它做筛选。
             */
            const spec = metricSpecFor(w.exercise.exerciseType);
            const lastPerf = getLastPerformance(w.slug);
            return (
              <div key={`${w.slug}-${index}`} className="workout-item">
                <img src={getAssetPath(w.slug, 1)} alt={w.exercise.name} width="56" height="56" />
                <div className="workout-item-info">
                  <div className="workout-item-name">
                    {exerciseName(w.slug, w.exercise.name)}
                    <button
                      className={`fav-btn ${favorites.includes(w.slug) ? 'on' : ''}`}
                      onClick={() => onToggleFavorite(w.slug)}
                      title={favorites.includes(w.slug) ? '取消收藏' : '收藏这个动作'}
                      aria-pressed={favorites.includes(w.slug)}
                    >
                      <Star size={13} fill={favorites.includes(w.slug) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="workout-item-meta">
                    {muscleName(w.exercise.primaryMuscle)} · {equipmentName(w.exercise.equipment)} ·{' '}
                    {w.sets.length} 组
                  </div>

                  {/* 上次练这个动作的成绩——编排时最该参考的一条信息 */}
                  {lastPerf && (
                    <div className="workout-item-last">上次 {formatLastPerformance(lastPerf)}</div>
                  )}

                  <div style={{ marginTop: 8 }}>
                    {w.sets.map((s) => (
                      <div key={s.id} className="set-row">
                        <span className="set-num">S{s.setNumber}</span>
                        <button
                          className={`set-check ${s.completed ? 'done' : ''}`}
                          onClick={() => toggleSet(index, s.id)}
                          title={s.completed ? '取消勾选' : '标记完成'}
                          aria-pressed={s.completed}
                        >
                          <Check size={10} color="#fff" />
                        </button>

                        {spec.durationSec && (
                          <>
                            <input
                              className="set-input"
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="9999"
                              value={s.durationSec ?? ''}
                              placeholder="-"
                              title="时长（秒）"
                              onChange={(e) =>
                                updateSetField(
                                  index,
                                  s.id,
                                  'durationSec',
                                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                                )
                              }
                            />
                            <span className="set-input-label">秒</span>
                          </>
                        )}

                        {spec.distance && (
                          <>
                            <input
                              className="set-input"
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="100000"
                              value={s.distanceM ?? ''}
                              placeholder="-"
                              title="距离（米）"
                              onChange={(e) =>
                                updateSetField(
                                  index,
                                  s.id,
                                  'distanceM',
                                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                                )
                              }
                            />
                            <span className="set-input-label">米</span>
                          </>
                        )}

                        {spec.reps && (
                          <>
                            <input
                              className="set-input"
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="999"
                              value={s.reps ?? ''}
                              placeholder="-"
                              title="次数"
                              onChange={(e) =>
                                updateSetField(
                                  index,
                                  s.id,
                                  'reps',
                                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                                )
                              }
                            />
                            <span className="set-input-label">次</span>
                          </>
                        )}

                        {spec.weight && (
                          <>
                            <input
                              className="set-input"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max="999"
                              step="0.5"
                              value={s.weight ?? ''}
                              placeholder="-"
                              title={
                                w.exercise.exerciseType === 'assisted_bodyweight'
                                  ? '辅助重量（kg）'
                                  : '重量（kg）'
                              }
                              onChange={(e) =>
                                updateSetField(
                                  index,
                                  s.id,
                                  'weight',
                                  e.target.value ? parseFloat(e.target.value) : undefined,
                                )
                              }
                            />
                            <span className="set-input-label">kg</span>
                          </>
                        )}

                        <button
                          className="workout-item-remove"
                          onClick={() => patchExercise(index, removeSet(w, s.id))}
                          title="删除这组"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn btn-secondary"
                      style={{ marginTop: 4, fontSize: 12, padding: '6px 12px' }}
                      onClick={() => patchExercise(index, addSet(w))}
                    >
                      <Plus size={12} /> 增加一组
                    </button>
                  </div>
                </div>

                {/* 顺序调整：复合动作该排在小肌群前面，用户需要能改 */}
                <div className="workout-item-side">
                  <button
                    className="workout-item-remove"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="上移"
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    className="workout-item-remove"
                    onClick={() => move(index, 1)}
                    disabled={index === workout.length - 1}
                    title="下移"
                  >
                    <ChevronDown size={15} />
                  </button>
                  <button
                    className="workout-item-remove"
                    onClick={() => removeExercise(index)}
                    title="移除动作"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <p className="section-label">备注</p>
        <textarea
          className="search-input"
          rows={2}
          placeholder="今天的感觉、调整的想法…"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={workout.length === 0}
          style={{ minWidth: 160, justifyContent: 'center' }}
        >
          <Play size={16} fill="currentColor" />
          开始训练
        </button>
      </div>

      <div style={{ marginTop: 32 }}>
        <div className="section-row" style={{ marginBottom: 8 }}>
          <p className="section-label" style={{ marginBottom: 0 }}>
            快速添加
          </p>
          {favorites.length > 0 && (
            <button
              className={`pill ${quickOnlyFav ? 'active' : ''}`}
              onClick={() => setQuickOnlyFav((v) => !v)}
              title="只看我收藏的动作"
            >
              <Star size={11} /> 收藏（{favorites.length}）
            </button>
          )}
        </div>
        <div className="filter-row">
          {quickPool.slice(0, quickCount).map((e) => (
            <button key={e.slug} className="pill" onClick={() => addExercise(e.slug)}>
              + {exerciseName(e.slug, e.name)}
            </button>
          ))}
          {quickPool.length === 0 && (
            <span className="quick-empty">
              {quickOnlyFav ? '收藏的动作都已加入今日训练。' : '没有可添加的动作了。'}
            </span>
          )}
          {quickPool.length > quickCount && (
            <button className="pill" onClick={() => setQuickCount((n) => n + 24)}>
              更多…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
