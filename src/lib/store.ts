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

/**
 * 一个动作「该记录哪些量」。
 *
 * 上游把动作分成 5 类，但界面之前对所有类型都渲染「次 + kg」，
 * 于是编排「跑步」时会看到要填 kg —— 这是错的。
 * 把判定收敛到这里，各处 UI 都按同一张表渲染，避免再各自 if-else。
 */
export interface MetricSpec {
  /** 记录次数（负重 / 自重 / 辅助自重） */
  reps: boolean;
  /** 记录重量 kg */
  weight: boolean;
  /** 记录时长（秒） */
  durationSec: boolean;
  /** 记录距离（米），目前仅有氧类需要 */
  distance: boolean;
}

export function metricSpecFor(exerciseType: string): MetricSpec {
  switch (exerciseType) {
    case 'weight_reps':
      return { reps: true, weight: true, durationSec: false, distance: false };
    case 'bodyweight_reps':
      return { reps: true, weight: false, durationSec: false, distance: false };
    // 辅助自重：次数是主体，重量表示「减了多少辅助」，不是负荷
    case 'assisted_bodyweight':
      return { reps: true, weight: true, durationSec: false, distance: false };
    case 'duration':
      return { reps: false, weight: false, durationSec: true, distance: false };
    case 'distance_duration':
      return { reps: false, weight: false, durationSec: true, distance: true };
    default:
      return { reps: true, weight: true, durationSec: false, distance: false };
  }
}

/**
 * 这份编排大约要练多久（秒）。
 * 算不上精确，但「今天大概 45 分钟」对用户安排时间很有用，
 * 比只显示「12 组」要具体。按每组的实际时长 + 组间休息累加。
 */
export function estimateWorkoutSeconds(workout: WorkoutExercise[], restSec = 60): number {
  let total = 0;
  for (const w of workout) {
    for (const s of w.sets) {
      // 负重/自重类按「每次 3 秒」估动作时间，时长类直接用记录值
      total += s.durationSec ?? (s.reps ?? 10) * 3;
      total += restSec;
    }
  }
  return total;
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

/** 读取收藏列表。之前这个字段只定义未接线，属于半成品 */
export function loadFavorites(): string[] {
  const d = loadData();
  return Array.isArray(d.favorites) ? d.favorites : [];
}

/** 切换收藏，返回新的收藏列表 */
export function toggleFavorite(slug: string): string[] {
  const d = loadData();
  const current = Array.isArray(d.favorites) ? d.favorites : [];
  const next = current.includes(slug)
    ? current.filter((s) => s !== slug)
    : [...current, slug];
  saveData({ ...d, favorites: next });
  return next;
}

export function recordSession(session: WorkoutSession): PersistedData {
  const data = loadData();
  data.sessions.unshift(session);
  saveData(data);
  return data;
}

// ---------- 备份：导出 / 导入 ----------

/** 导出文件的格式标识，导入时用于确认来源可信 */
export const BACKUP_KIND = 'strong-trainer-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: string;
  data: PersistedData;
}

/**
 * 打包成可下载的 JSON 文本。
 *
 * 存在意义：数据只躺在 localStorage 里，换手机、清缓存、Safari 回收站点数据
 * 都会让几个月的历史无声消失。给用户一个「能自己存一份」的出口，
 * 是成本最低、也最能消除不安的一件事。
 */
export function buildBackup(): string {
  const payload: BackupFile = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: loadData(),
  };
  return JSON.stringify(payload, null, 2);
}

export interface ImportResult {
  ok: boolean;
  /** 失败原因，直接可展示给用户 */
  error?: string;
  /** 本次导入带来的训练记录条数 */
  incoming: number;
  /** 合并/覆盖后最终的总条数 */
  total: number;
  /** 因为与现有记录重复而跳过的条数（仅合并模式） */
  skipped: number;
}

/**
 * 解析并写入备份。
 *
 * 采用「按 startedAt 去重合并」而非直接覆盖：用户很可能在换设备时
 * 两边都练过，直接覆盖等于丢掉新设备上的记录。
 * mode='replace' 才是明确的覆盖。
 */
export function importBackup(
  text: string,
  mode: 'merge' | 'replace' = 'merge',
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON', incoming: 0, total: 0, skipped: 0 };
  }

  const obj = parsed as Partial<BackupFile>;
  // 兼容直接导出 sessions 数组的旧格式，降低用户拿到「差不多格式」却导不进来的挫败
  let incomingSessions: WorkoutSession[];
  if (obj && obj.kind === BACKUP_KIND && obj.data && Array.isArray(obj.data.sessions)) {
    incomingSessions = obj.data.sessions;
  } else if (Array.isArray(parsed)) {
    incomingSessions = parsed as WorkoutSession[];
  } else {
    return {
      ok: false,
      error: '这不是本应用导出的备份文件',
      incoming: 0,
      total: 0,
      skipped: 0,
    };
  }

  // 结构校验：宁可拒绝，也不要把半损坏的数据写进用户的唯一存储
  const valid = incomingSessions.filter(
    (s) => s && typeof s.startedAt === 'string' && Array.isArray(s.exercises),
  );
  if (valid.length === 0) {
    return { ok: false, error: '备份里没有可用的训练记录', incoming: 0, total: 0, skipped: 0 };
  }

  const current = loadData();
  if (mode === 'replace') {
    const next: PersistedData = { sessions: valid, favorites: current.favorites };
    saveData(next);
    return { ok: true, incoming: valid.length, total: valid.length, skipped: 0 };
  }

  const seen = new Set(current.sessions.map((s) => s.startedAt));
  const fresh = valid.filter((s) => !seen.has(s.startedAt));
  const merged: PersistedData = {
    sessions: [...current.sessions, ...fresh].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    ),
    favorites: current.favorites,
  };
  saveData(merged);
  return {
    ok: true,
    incoming: valid.length,
    total: merged.sessions.length,
    skipped: valid.length - fresh.length,
  };
}

/** 触发浏览器下载，不依赖任何后端 */
export function downloadBackup(): void {
  const blob = new Blob([buildBackup()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `strong-trainer-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 在部分浏览器会取消下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 草稿（今日编排 + 进行中的训练） ----------

export const DRAFT_WORKOUT_KEY = 'strong-trainer-draft-workout';
export const DRAFT_NOTES_KEY = 'strong-trainer-draft-notes';
export const ACTIVE_SESSION_KEY = 'strong-trainer-active-session';
/** 组间休息偏好：属于「我的习惯」，跨刷新与跨训练都该记住 */
export const REST_DURATION_KEY = 'strong-trainer-rest-duration';

/** 一次训练里所有组的总数 */
export function countSets(workout: WorkoutExercise[]): number {
  return workout.reduce((sum, w) => sum + w.sets.length, 0);
}

/**
 * 上一次练某个动作时的最好一组。
 *
 * 这是健身 App 里感知价值最高的一条信息：用户下次编排/开练时最想知道的就是
 * 「上次我推了多少」。取已完成组里单组重量最高的那组作为参照基准
 * （组数多的用第一组会把热身重量当基准，不准）。
 * 没有任何真实数据时返回 null，让调用方决定不显示，而不是编一个默认值。
 */
export interface LastPerformance {
  weight?: number;
  reps?: number;
  durationSec?: number;
  /** 那次训练的开始时间，用于展示「3 天前」 */
  at: string;
}

export function getLastPerformance(slug: string): LastPerformance | null {
  const data = loadData();
  // sessions 以新在前（recordSession 用 unshift），按时间排序以防导入后乱序
  const ordered = [...data.sessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  for (const s of ordered) {
    const hit = s.exercises.find((w) => w.slug === slug);
    if (!hit) continue;
    const done = hit.sets.filter((x) => x.completed);
    if (done.length === 0) continue;
    // 时长类取最长的一组，负重/次数类取重量最大的一组
    const isTimed = done[0].durationSec !== undefined;
    let best = done[0];
    for (const cur of done) {
      if (isTimed) {
        if ((cur.durationSec ?? 0) > (best.durationSec ?? 0)) best = cur;
      } else if ((cur.actualWeight ?? cur.weight ?? 0) > (best.actualWeight ?? best.weight ?? 0)) {
        best = cur;
      }
    }
    return {
      weight: best.actualWeight ?? best.weight,
      reps: best.actualReps ?? best.reps,
      durationSec: best.durationSec,
      at: s.startedAt,
    };
  }
  return null;
}

/** 把上次表现压成一句短提示，供界面直接显示 */
export function formatLastPerformance(p: LastPerformance): string {
  const parts: string[] = [];
  if (p.durationSec) parts.push(`${p.durationSec} 秒`);
  else {
    if (p.weight) parts.push(`${p.weight}kg`);
    if (p.reps) parts.push(`${p.reps} 次`);
  }
  const days = Math.floor((Date.now() - new Date(p.at).getTime()) / 86400000);
  const when = days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`;
  return `${when}：${parts.join(' × ') || '已记录'}`;
}
