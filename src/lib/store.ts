import catalog from './catalog.json';
import type {
  Exercise,
  Metric,
  SetsRep,
  WorkoutExercise,
  WorkoutSession,
} from './types';

/**
 * 动作库。
 *
 * 数据由 .dsdata/build-catalog.cjs 从 Devillmy/exercises-dataset-zh 生成
 * （MIT 许可；动作演示媒体 © Gym visual，见 attribution.ts）。
 * 已经是前端可直接用的形状，所以这里不再做一次映射。
 */
export const allExercises: Exercise[] = catalog as Exercise[];

const bySlug = new Map(allExercises.map((e) => [e.slug, e]));

/** 按 slug 查动作 */
export function getExercise(slug: string): Exercise | null {
  return bySlug.get(slug) ?? null;
}

/** 界面统一用中文名；数据集里 100% 有中文名，空了才回落英文 */
export function displayName(e: Exercise): string {
  return e.nameZh || e.name;
}

/**
 * 媒体资源的公共前缀。
 *
 * 必须带 `import.meta.env.BASE_URL`，不能写死 `/media/`：
 * 部署在 GitHub Pages 子路径（/<仓库>/）时，素材实际位于 /<仓库>/media/…，
 * 写死根路径会让全部 1324 个动作图 404 —— 界面能开、图全裂。
 * BASE_URL 以 `/` 结尾，本地是 `/`，Pages 上是 `/<仓库>/`，两种都能拼对。
 */
const MEDIA_BASE = `${import.meta.env.BASE_URL}media/`;

/** 动作演示 GIF 的地址 */
export function gifPath(e: Exercise): string | null {
  return e.gif ? `${MEDIA_BASE}gif/${e.gif}` : null;
}

/** 动作缩略图地址 */
export function thumbPath(e: Exercise): string | null {
  return e.thumb ? `${MEDIA_BASE}thumb/${e.thumb}` : null;
}

// ---------- 场地（在家 / 健身房） ----------
//
// 判定在数据生成阶段就算好了（build-catalog.cjs 的 isHomeFriendly）：
// 自重、哑铃、弹力带、壶铃、瑜伽球、波速球、药球、滚轴、健腹轮都算能在家做，
// 其余（杠铃、绳索、固定器械、史密斯机…）归健身房。

export type Location = 'home' | 'gym';

export function toLocation(e: Exercise): Location {
  return e.home ? 'home' : 'gym';
}

/**
 * 展示用的场地标签。
 *
 * 自重动作两侧都能做，但 `toLocation` 只看 `home` 标记，而所有自重动作的
 * home 都是 true —— 于是健身房里排进来的自重动作会被标成「在家」，
 * 用户会以为生成器把场地弄错了。这里对它单独返回 `both`。
 *
 * 只用于「显示」，不要拿它做筛选：筛选一律走 canDoAtLocation。
 */
export type LocationTag = Location | 'both';

export function locationTag(e: Exercise): LocationTag {
  if (e.equipment === BODYWEIGHT_EQUIPMENT) return 'both';
  return toLocation(e);
}export type ClassifiedExercise = Exercise & { location: Location };

export const classifiedExercises: ClassifiedExercise[] = allExercises.map((e) => ({
  ...e,
  location: toLocation(e),
}));

export function countByLocation(loc: Location): number {
  return classifiedExercises.filter((e) => e.location === loc).length;
}

/**
 * 按「目标肌肉」聚合的动作数量，并按场地拆分。
 *
 * 计划生成器要据此提示「某肌群在某场地没有动作」，
 * 否则用户选了「在家 + 内收肌」只会拿到一组健身房器械动作，且毫无解释。
 */
export interface MuscleStat {
  /** 目标肌肉英文 key，用于程序判断 */
  key: string;
  /** 展示用中文名 */
  label: string;
  total: number;
  home: number;
  gym: number;
}

const MUSCLE_ORDER = [
  'pectorals', 'lats', 'upper back', 'traps', 'spine',
  'delts', 'rear delts',
  'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'lower back',
  'glutes', 'quads', 'hamstrings', 'adductors', 'abductors', 'calves',
  'cardiovascular system',
];

export const muscleStats: MuscleStat[] = (() => {
  const map = new Map<string, MuscleStat>();
  for (const e of classifiedExercises) {
    const key = e.target;
    if (!key) continue;
    let s = map.get(key);
    if (!s) {
      s = { key, label: e.targetZh || key, total: 0, home: 0, gym: 0 };
      map.set(key, s);
    }
    s.total++;
    s[e.location]++;
  }
  return [...map.values()].sort((a, b) => {
    const ia = MUSCLE_ORDER.indexOf(a.key), ib = MUSCLE_ORDER.indexOf(b.key);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return b.total - a.total;
  });
})();

/** 某肌群在指定场地的可选动作数 */
export function countByMuscle(key: string, loc: Location): number {
  const s = muscleStats.find((m) => m.key === key);
  if (!s) return 0;
  return loc === 'home' ? s.home : s.gym;
}

/** 部位（身体分区）→ 动作数，供筛选器用 */
export interface PartStat {
  key: string;
  label: string;
  count: number;
}

export const partStats: PartStat[] = (() => {
  const map = new Map<string, PartStat>();
  for (const e of classifiedExercises) {
    let s = map.get(e.bodyPart);
    if (!s) {
      s = { key: e.bodyPart, label: e.bodyPartZh || e.bodyPart, count: 0 };
      map.set(e.bodyPart, s);
    }
    s.count++;
  }
  const order = ['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'cardio', 'neck'];
  return [...map.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
})();

/**
 * 中文名相同、但数据集里是两个 key 的器械，合并为一组。
 *
 * 实测 `band`（54）与 `resistance band`（7）的中文名都是「弹力带」，
 * `cable`（157）与 `rope`（10）都是「绳索」。
 * 不合并的话，选择器里会出现两个一模一样的「弹力带」，
 * 用户没法知道该勾哪个，勾了一个另一个的动作还是生不出来。
 *
 * 合并是**安全的**：这些 key 在语义上就是同一个装备，
 * 动作的 equipment 字段保持原样不动，只影响筛选与统计。
 */
const EQUIPMENT_ALIASES: Record<string, string> = {
  'resistance band': 'band',
  rope: 'cable',
};

/** 把数据集的 equipment key 归一到「用户视角的装备」 */
export function normalizeEquipment(key: string): string {
  return EQUIPMENT_ALIASES[key] ?? key;
}

/**
 * 归一后的展示名。
 *
 * 两个 key 合并成一个选项后，标签只能取其一；这里固定优先取
 * 归一后 key 自己的中文名（`band` → 弹力带、`cable` → 绳索），
 * 保证同一选项在任何位置渲染出来的名字都一致 ——
 * 否则筛选器写「弹力带」、计划页写「阻力带」，用户会当成两样东西。
 */
export function equipmentLabel(normalizedKey: string, fallbackZh?: string): string {
  return EQUIPMENT_LABEL_ZH[normalizedKey] ?? fallbackZh ?? normalizedKey;
}

const EQUIPMENT_LABEL_ZH: Record<string, string> = {
  'body weight': '自重',
  band: '弹力带',
  cable: '绳索',
};

/** 器械 → 动作数，供筛选器用（只保留动作数 >= 8 的，否则筛选器会长到没法用） */
export const equipmentStats: PartStat[] = (() => {
  const map = new Map<string, PartStat>();
  for (const e of classifiedExercises) {
    /**
     * 走 normalizeEquipment：数据集里弹力带写作 `band` 与 `resistance band` 两种，
     * 归一前同一种器械会各出一个筛选项（54 与 7），共 61 个动作被拆成两半 ——
     * 用户筛「弹力带 54」时那 7 个动作就凭空消失了。绳索（cable / rope）同理。
     */
    const key = normalizeEquipment(e.equipment);
    let s = map.get(key);
    if (!s) {
      s = { key, label: equipmentLabel(key, e.equipmentZh), count: 0 };
      map.set(key, s);
    }
    s.count++;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
})();

/**
 * 自重器材的 key。
 *
 * 「自重」不是一件器械，而是**什么器械都没有时也能做**的兜底。
 * 所以它在计划生成里是永远可用的（不可取消），这也是这一层分组的基准：
 * 用户勾选的是「我额外拥有什么」，而不是「我允许用什么」。
 */
export const BODYWEIGHT_EQUIPMENT = 'body weight';

/**
 * 这个动作能否在指定场地做。
 *
 * 不能直接用 `toLocation(e) === loc`：那只反映数据集的 `home` 标记，
 * 而 `home` 的语义是「**在家也能**做」，不是「只能在家做」。
 * 自重动作（俯卧撑、引体向上、平板支撑）的 `home` 全为 true、健身房为 0，
 * 若照 `toLocation` 判定，去健身房就再也排不进任何自重动作 —— 这显然不对。
 *
 * 所以规则是：自重视为场地无关，两种场地都能做；其余按 `home` 标记走。
 * 计划生成、器械统计、UI 分组都用这一个函数，避免三处各写一套判定。
 */
export function canDoAtLocation(e: Exercise, loc: Location): boolean {
  if (e.equipment === BODYWEIGHT_EQUIPMENT) return true;
  return toLocation(e) === loc;
}

/**
 * 按场地列出可选器械，并给出「该场地 + 该器械」的动作数。
 *
 * 为什么不能直接用 equipmentStats：那是**全库**统计。
 * 在家筛选器里列出「绳索 157」毫无意义——绳索动作全在健身房，
 * 用户勾了也生不出计划。数量必须按场地分别统计。
 *
 * 只保留动作数 >= MIN 的：动作太少的器械（在家「轮胎 1」「健腹轮 2」）
 * 排进选择器只会让它变长，勾选后几乎注定凑不出动作。
 */
const EQUIPMENT_MIN_COUNT = 5;

export interface EquipmentOption {
  key: string;
  label: string;
  /** 该场地下、该器械的动作数（别名已合并） */
  count: number;
  /** 是否自重。自重永远可用且不可取消 */
  isBodyweight: boolean;
}

export function equipmentOptionsByLocation(loc: Location): EquipmentOption[] {
  const map = new Map<string, EquipmentOption>();
  for (const e of classifiedExercises) {
    /**
     * 自重选项在**任何场地**都要出现，哪怕该场地一个自重动作都没标。
     *
     * 实测 324 个自重动作的 `home` 全部为 true、健身房为 0，
     * 于是健身房流程里根本看不到「自重」这一项 —— 用户就没法把
     * 俯卧撑、引体向上、平板支撑这类动作排进计划，而它们在健身房同样能做。
     *
     * 根因是 `home` 表达的是「在家也能做」而不是「只能在家做」，
     * 自重恰好是「两边都能做」。所以这里不能只按 location 过滤，
     * 而要把自重视为场地无关的兜底项。
     *
     * 数量取全库总数（324），因为对用户来说「自重可用 324 个」就是事实。
     */
    if (e.equipment === BODYWEIGHT_EQUIPMENT) {
      const key = BODYWEIGHT_EQUIPMENT;
      const s = map.get(key) ?? {
        key,
        label: equipmentLabel(key, e.equipmentZh),
        count: 0,
        isBodyweight: true,
      };
      s.count++;
      map.set(key, s);
      continue;
    }
    if (e.location !== loc) continue;
    const key = normalizeEquipment(e.equipment);
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        label: equipmentLabel(key, e.equipmentZh),
        count: 0,
        isBodyweight: false,
      };
      map.set(key, s);
    }
    s.count++;
  }
  return [...map.values()]
    .filter((o) => o.isBodyweight || o.count >= EQUIPMENT_MIN_COUNT)
    // 自重永远排第一（它是基准），其余按数量降序
    .sort((a, b) => {
      if (a.isBodyweight !== b.isBodyweight) return a.isBodyweight ? -1 : 1;
      return b.count - a.count;
    });
}

/** 该场地默认选中的器械：自重 + 最主流的自由重量，让用户少点几下 */export function defaultEquipmentFor(loc: Location): string[] {
  const opts = equipmentOptionsByLocation(loc);
  const bw = opts.filter((o) => o.isBodyweight).map((o) => o.key);
  // 在家给哑铃，健身房给杠铃——这是两种场景下最常见的配置
  const preferred = loc === 'home' ? ['dumbbell'] : ['barbell'];
  const extras = preferred.filter((k) => opts.some((o) => o.key === k));
  return [...bw, ...extras];
}

/**
 * 某个部位在「指定场地 + 指定器械」下有多少动作。
 * 计划页的肌群 chip 用这个数字，才能和用户勾的器械对上。
 */
export function countByMuscleAndEquipment(
  target: string,
  loc: Location,
  equipment: string[],
): number {
  const allow = new Set(equipment.map(normalizeEquipment));
  return classifiedExercises.filter(
    (e) =>
      e.target === target &&
      canDoAtLocation(e, loc) &&
      allow.has(normalizeEquipment(e.equipment)),
  ).length;
}

/**
 * 判断一个动作的器械是否落在用户勾选的集合里。
 *
 * 必须走 normalizeEquipment：用户勾的是「弹力带」，而动作的 equipment
 * 可能是 `band` 或 `resistance band` 两种写法，直接比字符串会漏掉后者。
 * planner 与 UI 都用这一个函数，避免两处各写一套判定再次失配。
 */
export function equipmentAllowed(equipmentKey: string, selected: string[]): boolean {
  const k = normalizeEquipment(equipmentKey);
  return selected.some((s) => normalizeEquipment(s) === k);
}

/**
 * 一个动作「该记录哪些量」。
 *
 * 数据里只有 3 种计量方式，界面据此渲染输入框。
 * 之前所有动作都渲染「次 + kg」，于是编排「跑步」时会看到要填 kg —— 那是错的。
 * 把判定收敛在这里，各处 UI 都按同一张表渲染，避免再各自 if-else。
 */
export interface MetricSpec {
  /** 记录次数 */
  reps: boolean;
  /** 记录重量 kg。只有负重类才给，自重动作给 kg 输入框是误导 */
  weight: boolean;
  /** 记录时长（秒） */
  durationSec: boolean;
  /** 记录距离（米） */
  distance: boolean;
}

export function metricSpecFor(metric: Metric): MetricSpec {
  switch (metric) {
    case 'reps':
      return { reps: true, weight: true, durationSec: false, distance: false };
    case 'duration':
      return { reps: false, weight: false, durationSec: true, distance: false };
    case 'distance':
      return { reps: false, weight: false, durationSec: true, distance: true };
    default:
      return { reps: true, weight: true, durationSec: false, distance: false };
  }
}

/**
 * 这个动作是否该给「重量」输入框。
 *
 * 自重动作（俯卧撑、引体向上）默认不该有 kg —— 但用户可能加了负重，
 * 所以不是硬性禁止，只是默认不给，避免绝大多数人看到无意义的输入框。
 */
export function needsWeightField(e: Exercise): boolean {
  if (e.metric !== 'reps') return false;
  return e.equipment !== 'body weight' && e.equipment !== 'assisted';
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
      // 计时/距离类按记录值，次数类按「每次 3 秒」估动作时间
      total += s.durationSec ?? (s.reps ?? 10) * 3;
      total += restSec;
    }
  }
  return total;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 按动作的计量方式给一组合理的默认值，避免「跑步 10 次」这种荒唐预设 */
function defaultSet(exercise: Exercise, index: number): SetsRep {
  const base: SetsRep = { id: uid(), setNumber: index + 1, completed: false };
  if (exercise.metric === 'duration') return { ...base, durationSec: 30 };
  if (exercise.metric === 'distance') return { ...base, distanceM: 1000, durationSec: 300 };
  return { ...base, reps: 10 };
}

function makeSets(exercise: Exercise, count = 3): SetsRep[] {
  return Array.from({ length: count }, (_, i) => defaultSet(exercise, i));
}

/**
 * 由动作创建一条编排项。
 * setCount 可指定初始组数——计划生成器会按水平与 BMI 给出 2~4 组。
 * 每组的默认值按动作的计量方式给（计时类给秒、距离类给米、次数类给次），
 * 不再是所有动作都预设「10 次」。
 */
export function createWorkoutExercise(exercise: Exercise, setCount = 3): WorkoutExercise {
  return { exercise, slug: exercise.slug, sets: makeSets(exercise, setCount) };
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

/**
 * 历史按开始时间倒序。
 *
 * 之前 `loadData` 原样返回存储顺序，历史页直接 `.map()`，
 * 于是「最近练的排在前面」这件事只是**写入顺序的巧合**：
 *   - 正常训练走 recordSession，追加在数组末尾 → 恰好看起来是对的；
 *   - 但【导入备份】是 `[...current, ...fresh]` 再合并，导进来的旧记录
 *     如果时间更早就被排在后面，顺序立刻乱掉；
 *   - 手动改过存储、或未来做了云同步，同样会乱。
 * 所以排序放在读取处，让「时间是唯一权威」这件事不依赖调用方的写入习惯。
 *
 * 注意必须稳定：同一毫秒内的两条记录不能因排序而互换，
 * 否则 React 的 key 会变、展开态会跳。用原始下标兜底。
 */
function sortSessions(sessions: WorkoutSession[]): WorkoutSession[] {
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ta = new Date(a.s.startedAt).getTime();
      const tb = new Date(b.s.startedAt).getTime();
      // 时间戳非法（历史坏数据）时退化成保持原序，不要把记录挤到末尾
      if (Number.isNaN(ta) || Number.isNaN(tb)) return a.i - b.i;
      return tb - ta || a.i - b.i;
    })
    .map(({ s }) => s);
}

export function loadData(): PersistedData {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { sessions: [], favorites: [] };
    const parsed = JSON.parse(raw) as PersistedData;
    return {
      sessions: Array.isArray(parsed.sessions) ? sortSessions(parsed.sessions) : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    };
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
  distanceM?: number;
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

    const ex = getExercise(slug);
    const metric: Metric = ex?.metric ?? 'reps';

    // 按计量方式挑「最好的一组」：负重取最重、距离取最远、计时取最久。
    // 用第一组会把热身当基准，不准。
    const pick = (fn: (s: SetsRep) => number) =>
      done.reduce((best, cur) => (fn(cur) > fn(best) ? cur : best), done[0]);

    let best: SetsRep;
    if (metric === 'distance') best = pick((s) => s.actualDistanceM ?? s.distanceM ?? 0);
    else if (metric === 'duration') best = pick((s) => s.actualDurationSec ?? s.durationSec ?? 0);
    else best = pick((s) => s.actualWeight ?? s.weight ?? 0);

    return {
      weight: best.actualWeight ?? best.weight,
      reps: best.actualReps ?? best.reps,
      durationSec: best.actualDurationSec ?? best.durationSec,
      distanceM: best.actualDistanceM ?? best.distanceM,
      at: s.startedAt,
    };
  }
  return null;
}

/** 把上次表现压成一句短提示，供界面直接显示 */
export function formatLastPerformance(p: LastPerformance): string {
  const parts: string[] = [];
  if (p.distanceM) {
    parts.push(formatDistance(p.distanceM));
    if (p.durationSec) parts.push(formatDuration(p.durationSec));
  } else if (p.durationSec && !p.reps) {
    parts.push(`${p.durationSec} 秒`);
  } else {
    if (p.weight) parts.push(`${p.weight}kg`);
    if (p.reps) parts.push(`${p.reps} 次`);
  }
  const days = Math.floor((Date.now() - new Date(p.at).getTime()) / 86400000);
  const when = days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`;
  return `${when}：${parts.join(' × ') || '已记录'}`;
}

// ---------- 力量趋势 ----------

/**
 * 趋势图上的一个数据点：某次训练里这个动作的「最好一组」。
 *
 * 为什么取最好一组而不是平均值：训练中的热身组会严重拉低均值，
 * 让曲线看起来在退步，而用户真正关心的是「我这段时间能推起来的最大重量」。
 * 这与 getLastPerformance 的取值口径保持一致，两处显示的数字不会互相矛盾。
 */
export interface TrendPoint {
  /** 该次训练的开始时间 */
  at: string;
  /** 最好一组的重量（kg），未记录重量时为 undefined */
  weight?: number;
  /** 最好一组的次数 */
  reps?: number;
  /**
   * 估算 1RM（kg），Epley 公式：w × (1 + reps / 30)。
   *
   * 存在意义：只看重量会漏掉进步。60kg×8 和 60kg×8 看起来一样，
   * 但换成 62.5kg×8 只涨 2.5kg，而 60kg×12 的 1RM 已经从 76 涨到 84。
   * 次数变化带来的力量增长，只有换算成同一个尺度才看得出来。
   * reps=1 时公式退化为 w，与直觉一致。
   */
  est1RM?: number;
}

/** 某动作的趋势序列，供图表直接消费 */
export interface StrengthTrend {
  slug: string;
  name: string;
  points: TrendPoint[];
}

/** Epley 公式。重量或次数缺失时返回 undefined，不编造数值 */
function estimate1RM(weight?: number, reps?: number): number | undefined {
  if (!weight || !reps || reps <= 0) return undefined;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/**
 * 从全部历史里抽出某个动作的力量趋势。
 *
 * 只统计负重类动作（metric === 'reps'），因为「距离」「时长」类没有重量可比，
 * 画在一张折线图上会得到一条无意义的线。调用方应先过滤。
 *
 * 单次训练里同一动作出现多次（用户手动加了两个条目）时只取最好的一次，
 * 否则同一天会在曲线上产生两个点，看起来像一天练了两轮。
 */
export function getStrengthTrend(slug: string): StrengthTrend | null {
  const ex = getExercise(slug);
  const data = loadData();

  // 按时间升序：图表是从左到右的，顺序错了线就反着画
  const ordered = [...data.sessions].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const points: TrendPoint[] = [];
  for (const s of ordered) {
    const entries = s.exercises.filter((w) => w.slug === slug);
    if (entries.length === 0) continue;

    // 这一次训练里所有已完成组里最重的一组
    let bestWeight = -1;
    let bestReps: number | undefined;
    for (const w of entries) {
      for (const set of w.sets) {
        if (!set.completed) continue;
        const weight = set.actualWeight ?? set.weight ?? 0;
        if (weight > bestWeight) {
          bestWeight = weight;
          bestReps = set.actualReps ?? set.reps;
        } else if (weight === bestWeight && bestWeight > 0) {
          // 同重量时保留次数更多的那组，1RM 更高
          const reps = set.actualReps ?? set.reps;
          if ((reps ?? 0) > (bestReps ?? 0)) bestReps = reps;
        }
      }
    }
    if (bestWeight <= 0) continue;

    points.push({
      at: s.startedAt,
      weight: bestWeight,
      reps: bestReps,
      est1RM: estimate1RM(bestWeight, bestReps),
    });
  }

  if (points.length === 0) return null;

  // 「最好成绩」与「首尾差值」都交给组件按当前视角自行计算：
  // 1RM 与最大重量是两个不同尺度，在这里挑一个存下来，
  // 切视角时就会显示和曲线对不上的数字。
  return { slug, name: ex ? displayName(ex) : slug, points };
}

/** 趋势图可选的动作：只保留有 ≥2 次负重记录的，按记录次数从多到少 */
export interface TrendCandidate {
  slug: string;
  name: string;
  /** 有重量记录的训练次数 */
  count: number;
}

export function getTrendCandidates(): TrendCandidate[] {
  const data = loadData();
  const counter = new Map<string, number>();

  for (const s of data.sessions) {
    // 同一次训练里的同一动作只算一次，否则「记录次数」会虚高
    const seen = new Set<string>();
    for (const w of s.exercises) {
      if (seen.has(w.slug)) continue;
      const ex = getExercise(w.slug);
      if (ex?.metric !== 'reps') continue;
      const hasWeight = w.sets.some(
        (set) => set.completed && (set.actualWeight ?? set.weight ?? 0) > 0,
      );
      if (!hasWeight) continue;
      seen.add(w.slug);
      counter.set(w.slug, (counter.get(w.slug) ?? 0) + 1);
    }
  }

  return [...counter.entries()]
    // 一个点画不出趋势，至少两次才给用户看
    .filter(([, count]) => count >= 2)
    .map(([slug, count]) => ({
      slug,
      name: (() => {
        const ex = getExercise(slug);
        return ex ? displayName(ex) : slug;
      })(),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

/** 距离展示：不足 1 公里用米，超过就用公里，避免出现「5000 米」 */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} 公里` : `${m} 米`;
}

/** 时长展示：秒 → 「1 分 30 秒」，比「90 秒」好读 */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s === 0 ? `${m} 分钟` : `${m} 分 ${s} 秒`;
}
