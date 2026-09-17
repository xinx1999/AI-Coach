import catalog from './catalog.json';
import type { Exercise, SetsRep, WorkoutExercise, WorkoutSession } from './types';

/**
 * 精简版动作索引（由 scripts/build-catalog.mjs 从 @bryllim/workout-guide 的 manifest 生成）。
 * 不含 frames 与 attribution：图片路径可由 slug 推导，署名则统一维护在 attribution.ts。
 * 相比直接 import 包的 `exercises`，打包体积从 386 KB 降到 46 KB。
 */
interface CatalogEntry {
  slug: string;
  name: string;
  type: string;
  eq: string;
  muscle: string;
  secondary: string[];
  stretch: boolean;
}

export const allExercises: Exercise[] = (catalog as CatalogEntry[]).map((e) => ({
  id: `exercise-${e.slug}`,
  slug: e.slug,
  name: e.name,
  exerciseType: e.type as Exercise['exerciseType'],
  equipment: e.eq,
  primaryMuscle: e.muscle,
  secondaryMuscles: e.secondary,
  isStretch: e.stretch,
  frames: [
    { index: 1, path: `assets/${e.slug}/frame-1.svg` },
    { index: 2, path: `assets/${e.slug}/frame-2.svg` },
    { index: 3, path: `assets/${e.slug}/frame-3.svg` },
  ],
}) as Exercise);

const bySlug = new Map(allExercises.map((e) => [e.slug, e]));

/** 按 slug 查动作 */
export function getExercise(slug: string): Exercise | null {
  return bySlug.get(slug) ?? null;
}

// ---------- 场地分类（在家 / 健身房） ----------

export type Location = 'home' | 'gym';

/**
 * 器械 → 场地归属。
 * 划分依据是「是否需要健身房固定器械」：
 * 徒手、哑铃、弹力带、壶铃以及家用杂物（椅子/毛巾/门框/墙面）在家即可完成；
 * 杠铃、龙门架、固定器械，以及单杠/卧推凳/有氧器械/杠铃片（家庭不一定具备）归健身房。
 * 未列出的器械按健身房处理，避免把需要器械的动作误判为徒手可做。
 */
const GYM_EQUIPMENT = new Set([
  'Machine',
  'Barbell',
  'Cable',
  'Pull-up Bar',
  'Bench',
  'Cardio',
  'Plate',
]);

export function toLocation(equipment: string): Location {
  return GYM_EQUIPMENT.has(equipment) ? 'gym' : 'home';
}

/** 给动作打上场地标记（在原对象上扩展一个字段，不改变原有结构） */
export type ClassifiedExercise = Exercise & { location: Location };

export const classifiedExercises: ClassifiedExercise[] = allExercises.map((e) => ({
  ...e,
  location: toLocation(e.equipment),
}));

export function countByLocation(loc: Location): number {
  return classifiedExercises.filter((e) => e.location === loc).length;
}

/**
 * 各肌群的动作数量，按场地拆分。
 * 计划生成器需要据此提示「某部位在某场地没有动作」，
 * 否则用户选了「在家 + 内收肌」只会拿到一组健身房器械动作，且毫无解释。
 */
export interface MuscleStat {
  muscle: string;
  total: number;
  home: number;
  gym: number;
}

export const muscleStats: MuscleStat[] = (() => {
  const map = new Map<string, MuscleStat>();
  for (const e of classifiedExercises) {
    let s = map.get(e.primaryMuscle);
    if (!s) {
      s = { muscle: e.primaryMuscle, total: 0, home: 0, gym: 0 };
      map.set(e.primaryMuscle, s);
    }
    s.total++;
    s[e.location]++;
  }
  // 动作多的肌群排前面，方便选择时优先看到常用部位
  return [...map.values()].sort((a, b) => b.total - a.total);
})();

/** 某肌群在指定场地的可选动作数 */
export function countByMuscle(muscle: string, loc: Location): number {
  const s = muscleStats.find((m) => m.muscle === muscle);
  if (!s) return 0;
  return loc === 'home' ? s.home : s.gym;
}

/** 动作图统一放在 public/assets/<slug>/frame-N.svg，不走 npm 包的 assets 目录 */
export function getAssetPath(slug: string, frame: 1 | 2 | 3): string {
  return `/assets/${slug}/frame-${frame}.svg`;
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

/**
 * 由动作创建一条编排项。
 * setCount 可指定初始组数——计划生成器会按水平与 BMI 给出 2~4 组，
 * 默认值 3 保持既有行为不变。
 */
export function createWorkoutExercise(exercise: Exercise, setCount = 3): WorkoutExercise {
  return { exercise, slug: exercise.slug, sets: makeSets(setCount) };
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
