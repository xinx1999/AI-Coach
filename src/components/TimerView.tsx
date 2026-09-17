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
import { getAssetPath, getLastPerformance, formatLastPerformance, REST_DURATION_KEY } from '../lib/store';
import { usePersistentState } from '../lib/persist';
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
  const [restDuration, setRestDuration] = usePersistentState<number>(REST_DURATION_KEY, 90);
  const [phase, setPhase] = useState<'work' | 'rest'>('work');
  const [restRemaining, setRestRemaining] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  /**
   * 休息截止时间戳（毫秒）。
   *
   * 不用「每秒把 remaining 减 1」的写法——浏览器会对后台标签页的定时器节流，
   * 锁屏时更是几乎停摆，用户锁屏做完一组回来会发现倒计时还停在原处。
   * 改为记住「该在什么时刻结束」，每次 tick 只做重绘，
   * 剩余时间由目标时刻反推，被冻结多久都能在恢复瞬间显示正确值。
   */
  const restEndsAtRef = useRef<number | null>(null);
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

  /**
   * 当前动作上次练到什么水平。
   * 只在「开始新的一次训练」时读取一次即可，但读取成本极低（本地数组查找），
   * 依赖 currentWorkoutEx 变化重算，避免每次渲染都读 localStorage。
   */
  const lastPerf = useMemo(
    () => (currentWorkoutEx ? getLastPerformance(currentWorkoutEx.slug) : null),
    [currentWorkoutEx?.slug],
  );

  const clearRest = useCallback(() => {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    restEndsAtRef.current = null;
  }, []);

  /** 开始一段休息：只记住结束时刻，剩余时间由它反推 */
  const beginRest = useCallback((seconds: number) => {
    restEndsAtRef.current = Date.now() + seconds * 1000;
    setRestRemaining(seconds);
    setPhase('rest');
    setRestRunning(true);
  }, []);

  // 休息倒计时：每 250ms 按真实时间重算剩余，避免整数秒节流后越走越慢
  useEffect(() => {
    if (!restRunning) return;
    const tick = () => {
      const end = restEndsAtRef.current;
      if (end === null) return;
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRestRemaining(left);
      if (left <= 0) {
        restEndsAtRef.current = null;
        setRestRunning(false);
        setPhase('work');
      }
    };
    tick();
    restRef.current = setInterval(tick, 250);
    return clearRest;
  }, [restRunning, clearRest]);

  // 页面重新可见时立刻校正一次：后台被冻结期间不会累积误差
  useEffect(() => {
    if (!restRunning) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const end = restEndsAtRef.current;
        if (end !== null) setRestRemaining(Math.max(0, Math.round((end - Date.now()) / 1000)));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [restRunning]);

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
      if (patch.completed) beginRest(restDuration);
    },
    [session, onSessionChange, restDuration, beginRest],
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

  /**
   * 记录「实际完成值」。
   *
   * 计划值和实际值必须分开：计划是训练前的意图，实际是训练中的事实。
   * 之前只有计划值，用户加重了、少做了都无处可落，渐进超负荷的闭环就断了。
   * 这里写入 actualReps / actualWeight，未填则回落到计划值展示。
   */
  const setActual = useCallback(
    (exIndex: number, setIndex: number, field: 'actualReps' | 'actualWeight', value: number | undefined) => {
      if (!session) return;
      const exercises = session.exercises.map((w, i) =>
        i !== exIndex
          ? w
          : {
              ...w,
              sets: w.sets.map((s, j) => (j === setIndex ? { ...s, [field]: value } : s)),
            },
      );
      onSessionChange({ ...session, exercises });
    },
    [session, onSessionChange],
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

          {/* 上次练这个动作的成绩：训练中最需要参考的一条信息 */}
          {phase === 'work' && lastPerf && (
            <p className="guided-last">上次 {formatLastPerformance(lastPerf)}</p>
          )}

          {/*
            实际完成值：与计划值分开记录。
            计划是「打算做多少」，这里是「真的做了多少」——不记就断了渐进超负荷的依据。
            留空表示与计划一致，不用强迫用户每组都填。
          */}
          {phase === 'work' && current && currentSet && !currentSet.durationSec && (
            <div className="guided-actual">
              <span className="guided-actual-label">实际完成</span>
              <input
                className="set-input"
                type="number"
                inputMode="numeric"
                min="0"
                max="999"
                placeholder={currentSet.reps ? String(currentSet.reps) : '-'}
                value={currentSet.actualReps ?? ''}
                onChange={(e) =>
                  setActual(
                    current.exIndex,
                    current.setIndex,
                    'actualReps',
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  )
                }
              />
              <span className="set-input-label">次</span>
              <input
                className="set-input"
                type="number"
                inputMode="decimal"
                min="0"
                max="999"
                step="0.5"
                placeholder={currentSet.weight ? String(currentSet.weight) : '-'}
                value={currentSet.actualWeight ?? ''}
                onChange={(e) =>
                  setActual(
                    current.exIndex,
                    current.setIndex,
                    'actualWeight',
                    e.target.value ? parseFloat(e.target.value) : undefined,
                  )
                }
              />
              <span className="set-input-label">kg</span>
            </div>
          )}

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
  /** 本轮结束时刻：与休息倒计时同理，用目标时刻反推剩余，避免后台节流漂移 */
  const endsAtRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  // 每 250ms 按真实时间重算；跨段（训练→休息）时以「超出量」顺延，避免累积误差
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      let end = endsAtRef.current;
      if (end === null) {
        end = Date.now() + duration * 1000;
        endsAtRef.current = end;
      }
      const left = Math.round((end - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }
      // 本段结束：切到下一段，并把溢出时间带入，长后台后不会白等一整轮
      const overflow = Date.now() - end;
      setMode((prevMode) => {
        if (prevMode === 'work') return 'rest';
        setRound((r) => r + 1);
        return 'work';
      });
      endsAtRef.current = Date.now() + duration * 1000 - overflow;
      setRemaining(Math.max(0, Math.round((endsAtRef.current - Date.now()) / 1000)));
    };
    tick();
    intervalRef.current = setInterval(tick, 250);
    return clear;
  }, [running, duration, clear]);

  // 开始/暂停时重置截止时刻，暂停后继续不会带着旧时间戳跑
  useEffect(() => {
    endsAtRef.current = running ? Date.now() + remaining * 1000 : null;
    // 仅在 running 切换时执行；remaining 作为起点读取一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // 时长变化时同步剩余时间
  useEffect(() => {
    setRemaining(duration);
    if (running) endsAtRef.current = Date.now() + duration * 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // 页面重新可见时立刻校正
  useEffect(() => {
    if (!running) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && endsAtRef.current !== null) {
        setRemaining(Math.max(0, Math.round((endsAtRef.current - Date.now()) / 1000)));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running]);

  const reset = () => {
    clear();
    endsAtRef.current = null;
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
