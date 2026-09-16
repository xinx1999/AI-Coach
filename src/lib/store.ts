import { exercises as rawExercises, getExercise } from '@bryllim/workout-guide';
import type { Exercise, SetsRep, WorkoutExercise, WorkoutSession } from './types';

export const allExercises: Exercise[] = rawExercises as unknown as Exercise[];

export function getExerciseByName(slug: string): Exercise | null {
  return getExercise(slug) as Exercise | null;
}

/** 动作图统一放在 public/assets/<slug>/frame-N.png，不走 npm 包的 assets 目录 */
export function getAssetPath(slug: string, frame: 1 | 2 | 3): string {
  return `/assets/${slug}/frame-${frame}.png`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeSets(count = 3): SetsRep[] {
  return Array.from({ length: count }, (_, i) => ({
    id: uid(),
    setNumber: i + 1,
    completed: false,
  }));
}

export function createWorkoutExercise(exercise: Exercise): WorkoutExercise {
  return { exercise, slug: exercise.slug, sets: makeSets() };
}

export function updateSet(
  workoutEx: WorkoutExercise,
  setId: string,
  patch: Partial<SetsRep>,
): WorkoutExercise {
  return {
    ...workoutEx,
    sets: workoutEx.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
  };
}

export function addSet(workoutEx: WorkoutExercise): WorkoutExercise {
  return {
    ...workoutEx,
    sets: [
      ...workoutEx.sets,
      { id: uid(), setNumber: workoutEx.sets.length + 1, completed: false },
    ],
  };
}

export function removeSet(workoutEx: WorkoutExercise, setId: string): WorkoutExercise {
  return {
    ...workoutEx,
    sets: workoutEx.sets
      .filter((s) => s.id !== setId)
      .map((s, i) => ({ ...s, setNumber: i + 1 })),
  };
}

// ---------- 历史记录 ----------

export type PersistedData = {
  sessions: WorkoutSession[];
  favorites: string[];
};

const HISTORY_KEY = 'strong-trainer-data';

export function loadData(): PersistedData {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as PersistedData) : { sessions: [], favorites: [] };
  } catch {
    return { sessions: [], favorites: [] };
  }
}

export function saveData(data: PersistedData): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch {
    // 配额耗尽时静默降级
  }
}

export function recordSession(session: WorkoutSession): PersistedData {
  const data = loadData();
  data.sessions.unshift(session);
  saveData(data);
  return data;
}

// ---------- 草稿（今日编排 + 进行中的训练） ----------

export const DRAFT_WORKOUT_KEY = 'strong-trainer-draft-workout';
export const DRAFT_NOTES_KEY = 'strong-trainer-draft-notes';
export const ACTIVE_SESSION_KEY = 'strong-trainer-active-session';

/** 一次训练里所有组的总数 */
export function countSets(workout: WorkoutExercise[]): number {
  return workout.reduce((sum, w) => sum + w.sets.length, 0);
}

/** 已完成的组数 */
export function countCompletedSets(workout: WorkoutExercise[]): number {
  return workout.reduce((sum, w) => sum + w.sets.filter((s) => s.completed).length, 0);
}

/** 训练总容量（次数 × 重量），只统计同时填了次数和重量的组 */
export function totalVolume(workout: WorkoutExercise[]): number {
  return workout.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + (set.reps ?? 0) * (set.weight ?? 0), 0),
    0,
  );
}
