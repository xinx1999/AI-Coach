import { useState, useCallback, useEffect, useMemo } from 'react';
import TimerView from './components/TimerView';
import BrowseView from './components/BrowseView';
import BuildView from './components/BuildView';
import HistoryView from './components/HistoryView';
import PlanWizard from './components/PlanWizard';
import { usePersistentState } from './lib/persist';
import { ASSET_ATTRIBUTION, ATTRIBUTION_LINE } from './lib/attribution';
import {
  ACTIVE_SESSION_KEY,
  DRAFT_NOTES_KEY,
  DRAFT_WORKOUT_KEY,
  countSets,
  createWorkoutExercise,
  recordSession,
  loadFavorites,
  toggleFavorite,
  type ClassifiedExercise,
} from './lib/store';
import type { Screen, WorkoutExercise, WorkoutSession } from './lib/types';
import { Timer, Search, Plus, History, Sparkles, Dumbbell, Check } from 'lucide-react';

const SCREENS: Screen[] = ['timer', 'browse', 'plan', 'build', 'history'];

function getInitialScreen(): Screen {
  const hash = window.location.hash.replace('#', '') as Screen;
  return SCREENS.includes(hash) ? hash : 'browse';
}

function resetSets(workout: WorkoutExercise[]): WorkoutExercise[] {
  return workout.map((w) => ({
    ...w,
    sets: w.sets.map((s) => ({ ...s, completed: false, completedAt: undefined })),
  }));
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(getInitialScreen);

  // 今日编排：草稿持久化，刷新或浏览器被系统回收后仍能续上
  const [workout, setWorkout] = usePersistentState<WorkoutExercise[]>(DRAFT_WORKOUT_KEY, []);
  // 进行中的训练：同样持久化，避免练到一半丢掉整次记录
  const [session, setSession] = usePersistentState<WorkoutSession | null>(
    ACTIVE_SESSION_KEY,
    null,
  );
  const [notes, setNotes] = usePersistentState<string>(DRAFT_NOTES_KEY, '');
  /** 收藏的动作。存在与历史同一份数据里，所以从 loadFavorites 读初值 */
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [finished, setFinished] = useState<WorkoutSession | null>(null);
  /** 待确认的新计划：有进行中的训练时先暂存，等用户确认再写入 */
  const [pendingPlan, setPendingPlan] = useState<WorkoutExercise[] | null>(null);

  useEffect(() => {
    window.location.hash = screen;
  }, [screen]);

  const selectedSlugs = useMemo(() => workout.map((w) => w.slug), [workout]);

  /** 确认弹窗要如实告诉用户「会保住多少」，所以先数出已完成的组 */
  const completedSets = useMemo(
    () =>
      session
        ? session.exercises.reduce((sum, w) => sum + w.sets.filter((s) => s.completed).length, 0)
        : 0,
    [session],
  );

  const handleAddToWorkout = useCallback(
    (exercise: ClassifiedExercise) => {
      setWorkout((prev) =>
        prev.some((w) => w.slug === exercise.slug)
          ? prev
          : [...prev, createWorkoutExercise(exercise)],
      );
    },
    [setWorkout],
  );

  const handleStartWorkout = useCallback(() => {
    if (workout.length === 0) return;
    setSession({
      name: new Date().toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      notes,
      exercises: resetSets(workout),
      startedAt: new Date().toISOString(),
    });
    setFinished(null);
    setScreen('timer');
  }, [workout, notes, setSession]);

  const handleWorkoutComplete = useCallback(
    (finalExercises: WorkoutExercise[]) => {
      const now = new Date().toISOString();
      const finishedSession: WorkoutSession = {
        name: session?.name ?? new Date().toLocaleString('zh-CN'),
        notes: session?.notes ?? notes,
        exercises: finalExercises,
        startedAt: session?.startedAt ?? now,
        completedAt: now,
      };
      recordSession(finishedSession);
      setFinished(finishedSession);
      // 训练结束：清掉进行中的训练，把编排沿用为下一轮的草稿
      setSession(null);
      setWorkout(resetSets(finalExercises));
    },
    [session, notes, setSession, setWorkout],
  );

  const handleDiscardSession = useCallback(() => {
    setSession(null);
    setScreen('build');
  }, [setSession]);

  const handleToggleFavorite = useCallback((slug: string) => {
    setFavorites(toggleFavorite(slug));
  }, []);

  /**
   * 计划生成后覆盖编排页。
   * 若此时有进行中的训练，先弹确认：旧训练与新旧计划对不上，
   * 直接覆盖会让用户看到「编排是 A、计时里却是 B」的错乱。
   */
  const handleApplyPlan = useCallback(
    (exercises: WorkoutExercise[]) => {
      if (session) {
        setPendingPlan(exercises);
        return;
      }
      setWorkout(exercises);
      setScreen('build');
    },
    [session, setWorkout],
  );

  /**
   * 确认用新计划替换。
   *
   * 旧版本这里是直接 setSession(null) 把进行中的训练丢掉——弹窗虽然诚实写了
   * 「不会存入历史」，但用户刚做完几组，只是想去生成一份新计划，
   * 却被迫在「放弃训练」和「放弃计划」之间二选一，这并不合理。
   *
   * 现在改为【截断存档】：把已完成的组作为一次训练写进历史，未完成的部分丢弃。
   * 只练了 1 组也存，因为「练了 1 组」比「整次消失」有价值得多。
   * 一组都没完成则没有任何可存的事实，不产生空记录污染历史。
   */
  const confirmApplyPlan = useCallback(() => {
    if (session) {
      const exercises = session.exercises
        .map((w) => ({ ...w, sets: w.sets.filter((s) => s.completed) }))
        .filter((w) => w.sets.length > 0);
      if (exercises.length > 0) {
        recordSession({
          name: `${session.name}（中途结束）`,
          notes: session.notes,
          exercises,
          startedAt: session.startedAt,
          completedAt: new Date().toISOString(),
        });
      }
    }
    if (pendingPlan) setWorkout(pendingPlan);
    setPendingPlan(null);
    setSession(null);
    setScreen('build');
  }, [pendingPlan, session, setWorkout, setSession]);

  const navItems: Array<{ id: Screen; label: string; icon: React.ReactElement }> = [
    { id: 'browse', label: '浏览', icon: <Search size={16} /> },
    { id: 'plan', label: '计划', icon: <Sparkles size={16} /> },
    { id: 'build', label: '编排', icon: <Plus size={16} /> },
    { id: 'timer', label: '计时', icon: <Timer size={16} /> },
    { id: 'history', label: '历史', icon: <History size={16} /> },
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          Strong<span>.</span>
        </div>
        <nav className="app-nav">
          {navItems.map(({ id, label, icon }) => (
            <button
              key={id}
              className={`nav-btn ${screen === id ? 'active' : ''}`}
              onClick={() => setScreen(id)}
            >
              {icon} {label}
              {id === 'build' && workout.length > 0 && (
                <span className="nav-badge">{workout.length}</span>
              )}
              {/* 计时页有进行中的训练时标个点，鼠标悬停说明是什么，避免用户不知道点进去会看到什么 */}
              {id === 'timer' && session && (
                <span
                  className="nav-dot"
                  title={`进行中：${session.exercises.length} 个动作（${session.name}）`}
                />
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-body">
        {screen === 'browse' && (
          <BrowseView
            onSelect={handleAddToWorkout}
            selectedSlugs={selectedSlugs}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
        {screen === 'plan' && <PlanWizard onApply={handleApplyPlan} />}
        {screen === 'build' && (
          <BuildView
            workout={workout}
            onUpdate={setWorkout}
            onStartWorkout={handleStartWorkout}
            notes={notes}
            onNotesChange={setNotes}
            session={session}
            onResumeSession={() => setScreen('timer')}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
        {screen === 'timer' && (
          <TimerView
            session={session}
            onSessionChange={setSession}
            onWorkoutComplete={handleWorkoutComplete}
            onGoBuild={() => setScreen('build')}
            onDiscardSession={handleDiscardSession}
          />
        )}
        {screen === 'history' && <HistoryView />}

        <footer className="app-footer">
          {ATTRIBUTION_LINE}{' '}
          <a href={ASSET_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer noopener">
            {ASSET_ATTRIBUTION.license}
          </a>
        </footer>
      </main>

      {finished && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-emoji">💪</div>
            <h2 className="modal-title">训练完成！</h2>
            <p className="modal-sub">
              共 {finished.exercises.length} 个动作，{countSets(finished.exercises)} 组
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setFinished(null);
                  setScreen('history');
                }}
              >
                查看记录
              </button>
              <button className="btn btn-primary" onClick={() => setFinished(null)}>
                继续
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 有进行中的训练时，覆盖编排前先确认，避免用户悄悄丢掉半程记录 */}
      {pendingPlan && session && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-emoji">⚠️</div>
            <h2 className="modal-title">有进行中的训练</h2>
            <div className="modal-sub-block">
              你还有一次没结束的训练，用新计划会替换编排页，并结束这次训练。
            </div>
            <div className="modal-facts">
              <span className="modal-fact">
                <Dumbbell size={13} /> {session.exercises.length} 个动作
              </span>
              <span className="modal-fact">
                <Check size={13} /> {countSets(session.exercises)} 组
              </span>
              <span className="modal-fact">
                <Timer size={13} /> {session.name}
              </span>
            </div>
            <div className="modal-sub-block" style={{ marginTop: 14 }}>
              {completedSets > 0 ? (
                <>
                  已完成的 <strong>{completedSets} 组</strong>会存入历史记录，未完成的部分丢弃。
                </>
              ) : (
                <>这次训练还没有完成的组，结束它不会留下记录。</>
              )}
            </div>
            <div className="modal-actions-3">
              <button className="btn btn-secondary" onClick={() => setPendingPlan(null)}>
                取消
              </button>
              <button className="btn btn-secondary" onClick={() => setScreen('timer')}>
                先去完成
              </button>
              <button className="btn btn-primary" onClick={confirmApplyPlan}>
                仍要替换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
