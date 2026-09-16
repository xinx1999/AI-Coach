import { useState, useCallback, useMemo } from 'react';
import { Trash2, Plus, Dumbbell, Check, Play, CirclePlay } from 'lucide-react';
import {
  allExercises,
  getAssetPath,
  updateSet,
  addSet,
  removeSet,
  countSets,
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
}

export default function BuildView({
  workout,
  onUpdate,
  onStartWorkout,
  notes,
  onNotesChange,
  session,
  onResumeSession,
}: Props) {
  const [quickCount, setQuickCount] = useState(12);

  const totalSets = useMemo(() => countSets(workout), [workout]);

  const patchExercise = useCallback(
    (index: number, next: WorkoutExercise) => {
      onUpdate(workout.map((w, i) => (i === index ? next : w)));
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
    (index: number, setId: string, field: 'reps' | 'weight', value: number | undefined) => {
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
          {workout.map((w, index) => (
            <div key={`${w.slug}-${index}`} className="workout-item">
              <img src={getAssetPath(w.slug, 1)} alt={w.exercise.name} width="56" height="56" />
              <div className="workout-item-info">
                <div className="workout-item-name">{exerciseName(w.slug, w.exercise.name)}</div>
                <div className="workout-item-meta">
                  {muscleName(w.exercise.primaryMuscle)} · {equipmentName(w.exercise.equipment)} ·{' '}
                  {w.sets.length} 组
                </div>
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
                      <span className="set-input-label">次</span>
                      <input
                        className="set-input"
                        type="number"
                        min="0"
                        max="999"
                        value={s.reps ?? ''}
                        placeholder="-"
                        onChange={(e) =>
                          updateSetField(
                            index,
                            s.id,
                            'reps',
                            e.target.value ? parseInt(e.target.value, 10) : undefined,
                          )
                        }
                      />
                      <span className="set-input-label">kg</span>
                      <input
                        className="set-input"
                        type="number"
                        min="0"
                        max="999"
                        step="0.5"
                        value={s.weight ?? ''}
                        placeholder="-"
                        onChange={(e) =>
                          updateSetField(
                            index,
                            s.id,
                            'weight',
                            e.target.value ? parseFloat(e.target.value) : undefined,
                          )
                        }
                      />
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
              <button
                className="workout-item-remove"
                onClick={() => removeExercise(index)}
                title="移除动作"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
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
        <p className="section-label">快速添加</p>
        <div className="filter-row">
          {allExercises
            .filter((e) => !workout.some((w) => w.slug === e.slug))
            .slice(0, quickCount)
            .map((e) => (
              <button key={e.slug} className="pill" onClick={() => addExercise(e.slug)}>
                + {exerciseName(e.slug, e.name)}
              </button>
            ))}
          {allExercises.length - workout.length > quickCount && (
            <button className="pill" onClick={() => setQuickCount((n) => n + 24)}>
              更多…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
