import { useState, useCallback, useEffect, useMemo } from 'react';
import TimerView from './components/TimerView';
import BrowseView from './components/BrowseView';
import BuildView from './components/BuildView';
import HistoryView from './components/HistoryView';
import { usePersistentState } from './lib/persist';
import { ASSET_ATTRIBUTION, ATTRIBUTION_LINE } from './lib/attribution';
import {
  ACTIVE_SESSION_KEY,
  DRAFT_NOTES_KEY,
  DRAFT_WORKOUT_KEY,
  countSets,
  createWorkoutExercise,
  recordSession,
} from './lib/store';
import type { Exercise, Screen, WorkoutExercise, WorkoutSession } from './lib/types';
import { Timer, Search, Plus, History } from 'lucide-react';

const SCREENS: Screen[] = ['timer', 'browse', 'build', 'history'];

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
  const [finished, setFinished] = useState<WorkoutSession | null>(null);

  useEffect(() => {
    window.location.hash = screen;
  }, [screen]);

  const selectedSlugs = useMemo(() => workout.map((w) => w.slug), [workout]);

  const handleAddToWorkout = useCallback(
    (exercise: Exercise) => {
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

  const navItems: Array<{ id: Screen; label: string; icon: React.ReactElement }> = [
    { id: 'browse', label: '浏览', icon: <Search size={16} /> },
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
              {id === 'timer' && session && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-body">
        {screen === 'browse' && (
          <BrowseView onSelect={handleAddToWorkout} selectedSlugs={selectedSlugs} />
        )}
        {screen === 'build' && (
          <BuildView
            workout={workout}
            onUpdate={setWorkout}
            onStartWorkout={handleStartWorkout}
            notes={notes}
            onNotesChange={setNotes}
            session={session}
            onResumeSession={() => setScreen('timer')}
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
    </div>
  );
}
