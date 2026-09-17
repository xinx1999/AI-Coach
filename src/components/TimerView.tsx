import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  HeartPulse,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  SkipForward,
  Dumbbell,
  Trash2,
  BookOpen,
} from 'lucide-react';
import { getAssetPath } from '../lib/store';
import { exerciseName, equipmentName, muscleName } from '../lib/zh';
import type { TimerTab, WorkoutExercise, WorkoutSession } from '../lib/types';
import GuidePanel from './GuidePanel';

interface Props {
  session: WorkoutSession | null;
  onSessionChange: (s: WorkoutSession | null) => void;
  onWorkoutComplete: (exercises: WorkoutExercise[]) => void;
  onGoBuild: () => void;
  onDiscardSession: () => void;
}

const INTERVAL_PRESETS: Record<'work' | 'rest', number[]> = {
  work: [30, 45, 60, 90, 120],
  rest: [15, 30, 45, 60, 90, 120],
};

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const CIRCUMFERENCE = 2 * Math.PI * 100;

/** 把「动作 + 组」的二维结构拍平成一维序列，跟组模式沿这个序列推进 */
interface Step {
  exIndex: number;
  setIndex: number;
}

function flattenSteps(workout: WorkoutExercise[]): Step[] {
  const steps: Step[] = [];
  workout.forEach((w, exIndex) => {
    w.sets.forEach((_, setIndex) => steps.push({ exIndex, setIndex }));
  });
  return steps;
}

function stepFlatIndex(steps: Step[], exIndex: number, setIndex: number): number {
  return steps.findIndex((st) => st.exIndex === exIndex && st.setIndex === setIndex);
}

export default function TimerView({
  session,
  onSessionChange,
  onWorkoutComplete,
  onGoBuild,
  onDiscardSession,
}: Props) {
  // 有进行中的训练时默认落在跟组模式，否则落在自由间歇
  const [tab, setTab] = useState<TimerTab>(session ? 'guided' : 'interval');

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="tab-row">
        <button
          className={`tab-btn ${tab === 'guided' ? 'active' : ''}`}
          onClick={() => setTab('guided')}
        >
          跟组计时
          {session && <span className="nav-dot" />}
        </button>
        <button
          className={`tab-btn ${tab === 'interval' ? 'active' : ''}`}
          onClick={() => setTab('interval')}
        >
          自由间歇
        </button>
      </div>

      {tab === 'guided' ? (
        <GuidedTimer
          session={session}
          onSessionChange={onSessionChange}
          onWorkoutComplete={onWorkoutComplete}
          onGoBuild={onGoBuild}
          onDiscardSession={onDiscardSession}
        />
      ) : (
        <IntervalTimer />
      )}
    </div>
  );
}

// ============ 跟组计时 ============

function GuidedTimer({
  session,
  onSessionChange,
  onWorkoutComplete,
  onGoBuild,
  onDiscardSession,
}: Props) {
  const [restDuration, setRestDuration] = useState(90);
  const [phase, setPhase] = useState<'work' | 'rest'>('work');
  const [restRemaining, setRestRemaining] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = useMemo(() => (session ? flattenSteps(session.exercises) : []), [session]);

  // 当前指针：第一个还没完成的组的位置；全部完成则等于 steps.length
  const cursor = useMemo(() => {
    if (!session) return 0;
    let i = 0;
    for (const w of session.exercises) {
      for (const s of w.sets) {
        if (!s.completed) return i;
        i++;
      }
    }
    return steps.length;
  }, [session, steps.length]);

  const allDone = steps.length > 0 && cursor >= steps.length;
  const current = !allDone ? steps[cursor] : undefined;
  const currentWorkoutEx = current && session ? session.exercises[current.exIndex] : null;
  const currentSet = currentWorkoutEx && current ? currentWorkoutEx.sets[current.setIndex] : null;

  const clearRest = useCallback(() => {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
  }, []);

  // 休息倒计时
  useEffect(() => {
    if (!restRunning) return;
    restRef.current = setInterval(() => {
      setRestRemaining((prev) => {
        if (prev <= 1) {
          setRestRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return clearRest;
  }, [restRunning, clearRest]);

  useEffect(() => clearRest, [clearRest]);

  const endRest = useCallback(() => {
    clearRest();
    setRestRunning(false);
    setRestRemaining(0);
    setPhase('work');
  }, [clearRest]);

  const patchSet = useCallback(
    (
      exIndex: number,
      setIndex: number,
      patch: { completed?: boolean; completedAt?: string },
    ) => {
      if (!session) return;
      const exercises = session.exercises.map((w, i) =>
        i !== exIndex
          ? w
          : { ...w, sets: w.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) },
      );
      onSessionChange({ ...session, exercises });
      // 勾完一组自动进入休息
      if (patch.completed) {
        setPhase('rest');
        setRestRemaining(restDuration);
        setRestRunning(true);
      }
    },
    [session, onSessionChange, restDuration],
  );

  const toggleSet = useCallback(
    (exIndex: number, setIndex: number) => {
      if (!session) return;
      const s = session.exercises[exIndex]?.sets[setIndex];
      if (!s) return;
      if (s.completed) {
        // 取消勾选：停掉休息倒计时，回到训练态
        endRest();
        patchSet(exIndex, setIndex, { completed: false, completedAt: undefined });
      } else {
        patchSet(exIndex, setIndex, {
          completed: true,
          completedAt: new Date().toISOString(),
        });
      }
    },
    [session, patchSet, endRest],
  );

  /** 跳到某组：该组之前的全部标记完成，该组本身标记为未完成 */
  const jumpTo = useCallback(
    (targetFlat: number) => {
      if (!session) return;
      const clamped = Math.max(0, Math.min(steps.length - 1, targetFlat));
      const exercises = session.exercises.map((w, i) => ({
        ...w,
        sets: w.sets.map((s, j) => {
          const flat = stepFlatIndex(steps, i, j);
          const done = flat < clamped;
          return {
            ...s,
            completed: done,
            completedAt: done ? s.completedAt ?? new Date().toISOString() : undefined,
          };
        }),
      }));
      endRest();
      onSessionChange({ ...session, exercises });
    },
    [session, steps, endRest, onSessionChange],
  );

  // ---- 无进行中的训练 ----
  if (!session) {
    return (
      <div className="empty-state">
        <Dumbbell size={40} color="var(--text-muted)" />
        <h3>还没有进行中的训练</h3>
        <p>先去「编排」选好今天的动作，然后点开始训练。</p>
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onGoBuild}>
          去编排
        </button>
      </div>
    );
  }

  // 进行中的训练必须有动作；若为空（历史遗留的坏数据），引导用户重开而不是渲染空壳
  if (session.exercises.length === 0) {
    return (
      <div className="empty-state">
        <Dumbbell size={40} color="var(--text-muted)" />
        <h3>这次训练里没有动作</h3>
        <p>可能上次编排被清空了。丢弃它，重新安排今天的动作即可。</p>
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onDiscardSession}>
          丢弃并去编排
        </button>
      </div>
    );
  }

  const totalSets = steps.length;
  const doneSets = Math.min(cursor, totalSets);
  // 全部组勾完：停在待确认状态，而不是立刻结算，给用户反悔的余地
  const awaitingConfirm = allDone;

  return (
    <>
      <div className="section-row">
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {awaitingConfirm
            ? '全部完成'
            : currentWorkoutEx
              ? exerciseName(currentWorkoutEx.slug, currentWorkoutEx.exercise.name)
              : '训练结束'}
        </h2>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {doneSets}/{totalSets} 组完成
        </span>
      </div>

      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }}
        />
      </div>

      {awaitingConfirm && (
        <div className="finish-card">
          <div className="modal-emoji">🎯</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>所有组都完成了</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
            {session.exercises.length} 个动作 · {totalSets} 组
          </p>
          <div className="guided-actions" style={{ marginTop: 0 }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                const last = steps[steps.length - 1];
                if (last) {
                  endRest();
                  patchSet(last.exIndex, last.setIndex, {
                    completed: false,
                    completedAt: undefined,
                  });
                }
              }}
            >
              还有一组没做完
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => onWorkoutComplete(session.exercises)}
            >
              <Check size={16} /> 结束训练
            </button>
          </div>
        </div>
      )}

      {!awaitingConfirm && currentWorkoutEx && (
        <div className="guided-card">
          <FrameStrip slug={currentWorkoutEx.slug} />
          <div className="guided-meta">
            {muscleName(currentWorkoutEx.exercise.primaryMuscle)} ·{' '}
            {equipmentName(currentWorkoutEx.exercise.equipment)}
            {currentWorkoutEx.exercise.secondaryMuscles.length > 0 && (
              <> · 协同 {currentWorkoutEx.exercise.secondaryMuscles.map(muscleName).join('、')}</>
            )}
          </div>

          <div className="guided-timer">
            {phase === 'rest' ? (
              <>
                <span className="guided-phase rest">休息</span>
                <span className="guided-count">{formatTime(restRemaining)}</span>
                <button className="btn btn-secondary" onClick={endRest}>
                  <SkipForward size={14} /> 跳过休息
                </button>
              </>
            ) : (
              <>
                <span className="guided-phase work">
                  第 {currentSet?.setNumber} 组 / 共 {currentWorkoutEx.sets.length} 组
                </span>
                <span className="guided-target">
                  {currentSet?.reps ? `${currentSet.reps} 次` : '按计划完成'}
                  {currentSet?.weight ? ` · ${currentSet.weight} kg` : ''}
                </span>
              </>
            )}
          </div>

          <div className="guided-actions">
            <button
              className="btn btn-secondary btn-icon"
              onClick={() => jumpTo(cursor - 1)}
              disabled={cursor === 0}
              title="上一组"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => current && toggleSet(current.exIndex, current.setIndex)}
            >
              <Check size={16} /> 完成这组
            </button>
            <button
              className="btn btn-secondary btn-icon"
              onClick={() => jumpTo(cursor + 1)}
              disabled={cursor >= steps.length - 1}
              title="跳到下一组"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <p className="guided-hint">点「完成这组」自动开始休息倒计时；点下方色块可直接跳组或取消勾选。</p>

          <div className="rest-preset-row">
            <span className="rest-preset-label">
              <HeartPulse size={13} /> 组间休息
            </span>
            {[30, 60, 90, 120].map((s) => (
              <button
                key={s}
                className={`preset-btn ${restDuration === s ? 'active' : ''}`}
                onClick={() => setRestDuration(s)}
              >
                {s}s
              </button>
            ))}
          </div>

          {/* 动作要领速查：默认收起，避免训练中信息过载；点开看要领与呼吸 */}
          <div className="guided-guide">
            <button
              className="guided-guide-toggle"
              onClick={() => setGuideOpen((v) => !v)}
              aria-expanded={guideOpen}
            >
              <BookOpen size={14} />
              动作要领
              <ChevronDown
                size={14}
                style={{
                  marginLeft: 'auto',
                  transform: guideOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform .15s',
                }}
              />
            </button>
            {guideOpen && (
              <div className="guided-guide-body">
                <GuidePanel slug={currentWorkoutEx.slug} compact />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="guided-list">
        {session.exercises.map((w, exIndex) => {
          const isActive = current?.exIndex === exIndex;
          return (
            <div key={`${w.slug}-${exIndex}`} className={`guided-row ${isActive ? 'active' : ''}`}>
              <img
                src={getAssetPath(w.slug, 1)}
                alt={w.exercise.name}
                width="40"
                height="40"
                loading="lazy"
              />
              <div className="guided-row-main">
                <div className="guided-row-name">{exerciseName(w.slug, w.exercise.name)}</div>
                <div className="guided-row-sets">
                  {w.sets.map((s, setIndex) => (
                    <button
                      key={s.id}
                      className={`set-chip ${s.completed ? 'done' : ''} ${
                        current?.exIndex === exIndex && current?.setIndex === setIndex
                          ? 'current'
                          : ''
                      }`}
                      onClick={() => toggleSet(exIndex, setIndex)}
                      title={`第 ${s.setNumber} 组`}
                    >
                      {s.completed ? <Check size={10} /> : s.setNumber}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="guided-footer">
        <button className="btn btn-secondary" onClick={onGoBuild}>
          返回编排
        </button>
        <button className="btn btn-secondary" onClick={onDiscardSession}>
          <Trash2 size={14} /> 放弃这次训练
        </button>
      </div>
    </>
  );
}

/** 三帧图并排展示，直观呈现动作过程 */
function FrameStrip({ slug }: { slug: string }) {
  return (
    <div className="frame-strip">
      {([1, 2, 3] as const).map((f) => (
        <img key={f} src={getAssetPath(slug, f)} alt="" loading="lazy" />
      ))}
    </div>
  );
}

// ============ 自由间歇 ============

function IntervalTimer() {
  const [mode, setMode] = useState<'work' | 'rest'>('work');
  const [duration, setDuration] = useState(60);
  const [remaining, setRemaining] = useState(60);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (mode === 'work') {
            setMode('rest');
          } else {
            setMode('work');
            setRound((r) => r + 1);
          }
          return duration;
        }
        return prev - 1;
      });
    }, 1000);
    return clear;
  }, [running, mode, duration, clear]);

  // 时长变化时同步剩余时间
  useEffect(() => {
    setRemaining(duration);
  }, [duration]);

  const reset = () => {
    clear();
    setRemaining(duration);
    setRunning(false);
    setRound(1);
    setMode('work');
  };

  const progress = duration > 0 ? remaining / duration : 0;
  const offset = CIRCUMFERENCE * (1 - progress);

  return (
    <>
      <div className="section-row">
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
          计时器 · 第 {round} 组
        </h2>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {mode === 'work' ? '训练' : '休息'}
        </span>
      </div>

      <div className="timer-display">
        <div className={`timer-ring ${mode === 'rest' ? 'rest-mode' : ''}`}>
          <svg width="240" height="240" viewBox="0 0 240 240">
            <circle className="timer-ring-bg" cx="120" cy="120" r="100" />
            <circle
              className="timer-ring-fg"
              cx="120"
              cy="120"
              r="100"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="timer-value">
            <span className="timer-number">{formatTime(remaining)}</span>
            <span className="timer-label">{mode === 'work' ? '训练中' : '休息中'}</span>
          </div>
        </div>

        <div className="timer-controls">
          <button
            className="btn btn-primary"
            onClick={() => setRunning((v) => !v)}
            style={{ minWidth: 120, justifyContent: 'center' }}
          >
            {running ? (
              <>
                <Pause size={16} /> 暂停
              </>
            ) : (
              <>
                <Play size={16} /> 开始
              </>
            )}
          </button>
          <button className="btn btn-secondary btn-icon" onClick={reset} title="重置">
            <RotateCcw size={16} />
          </button>
        </div>

        <div>
          <p className="section-label">时长 (秒)</p>
          <div className="filter-row">
            {INTERVAL_PRESETS[mode].map((s) => (
              <button
                key={s}
                className={`preset-btn ${duration === s ? 'active' : ''}`}
                onClick={() => {
                  setDuration(s);
                  setRemaining(s);
                }}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
