import {
  classifiedExercises,
  createWorkoutExercise,
  type ClassifiedExercise,
  type Location,
} from './store';
import { muscleName } from './zh';
import type { WorkoutExercise } from './types';

export type Level = 'beginner' | 'intermediate';

export interface PlanInput {
  heightCm: number;
  weightKg: number;
  /** 想练的部位（英文肌群名） */
  muscles: string[];
  location: Location;
  level: Level;
}

export interface BmiInfo {
  value: number;
  label: string;
  /** 训练侧重建议 */
  advice: string;
}

/** BMI 分级（采用中国成人标准，与 WHO 国际标准略有差异） */
export function calcBmi(heightCm: number, weightKg: number): BmiInfo {
  const h = heightCm / 100;
  const value = weightKg / (h * h);
  const rounded = Math.round(value * 10) / 10;

  if (value < 18.5) {
    return {
      value: rounded,
      label: '偏瘦',
      advice: '以增肌为主：复合动作打底，组间休息充分，注意饮食补足热量。',
    };
  }
  if (value < 24) {
    return {
      value: rounded,
      label: '正常',
      advice: '体重在健康区间：可兼顾力量与体能，按目标部位均衡安排。',
    };
  }
  if (value < 28) {
    return {
      value: rounded,
      label: '超重',
      advice: '优先全身性复合动作与有氧，控制组间休息，注意膝踝关节保护。',
    };
  }
  return {
    value: rounded,
    label: '偏胖',
    advice: '侧重低冲击有氧与器械训练，避免跳跃类动作，循序渐进增加强度。',
  };
}

/**
 * 每个部位安排几个动作。
 * 部位多时相应减少，避免一次练太久；BMI 偏高时略减量，降低关节负担。
 */
function slotsPerMuscle(muscleCount: number, bmi: BmiInfo): number {
  if (muscleCount <= 1) return bmi.value >= 28 ? 4 : 5;
  if (muscleCount === 2) return 4;
  return 3;
}

/** 组数与次数按水平与 BMI 决定 */
function setScheme(level: Level, bmi: BmiInfo) {
  const base = level === 'beginner' ? { sets: 3, reps: 12 } : { sets: 4, reps: 10 };
  // 偏胖/超重：略增次数、略减组数，偏向肌耐力与代谢消耗
  if (bmi.value >= 28) return { sets: Math.max(2, base.sets - 1), reps: base.reps + 3 };
  if (bmi.value >= 24) return { sets: base.sets, reps: base.reps + 2 };
  if (bmi.value < 18.5) return { sets: base.sets, reps: Math.max(6, base.reps - 2) };
  return base;
}

/**
 * 时长类动作（平板支撑、跑步等）按秒计，不按次数。
 * 这里把秒数写进 durationSec、不写 reps，避免用户看到「12 次平板支撑」这种错误提示。
 */
function isDurationExercise(ex: ClassifiedExercise): boolean {
  return ex.exerciseType === 'duration' || ex.exerciseType === 'distance_duration';
}

/**
 * 时长类动作的每组秒数。
 * 不能简单用「次数 × 3 秒」折算：12 次的动作变成 36 秒尚可，
 * 但进阶 4×10 会得到 30 秒、偏胖 2×15 只剩 45 秒，对平板支撑来说偏短且毫无依据。
 * 改为按水平给定秒数，BMI 偏高时略增（偏向肌耐力），偏瘦时略减。
 */
function durationFor(level: Level, bmi: BmiInfo): number {
  const base = level === 'beginner' ? 30 : 45;
  if (bmi.value >= 28) return base + 15;
  if (bmi.value >= 24) return base + 10;
  return base;
}

/**
 * 从候选动作里挑若干个。
 * 策略：优先覆盖不同器械（增加多样性），其次随机打散避免每次都一样。
 */
function pick(pool: ClassifiedExercise[], count: number): ClassifiedExercise[] {
  if (pool.length <= count) return [...pool];

  // 按器械分组，每轮从不同器械里各取一个，保证多样性
  const groups = new Map<string, ClassifiedExercise[]>();
  for (const e of pool) {
    const list = groups.get(e.equipment) ?? [];
    list.push(e);
    groups.set(e.equipment, list);
  }
  for (const list of groups.values()) {
    // 组内打散，让同一器械的动作不会每次都相同
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  const buckets = [...groups.values()];
  const out: ClassifiedExercise[] = [];
  let cursor = 0;
  while (out.length < count && buckets.some((b) => b.length > 0)) {
    const b = buckets[cursor % buckets.length];
    const item = b.shift();
    if (item) out.push(item);
    cursor++;
  }
  return out;
}

export interface GeneratedPlan {
  exercises: WorkoutExercise[];
  bmi: BmiInfo;
  /** 生成过程中需要告知用户的情况，例如某部位在该场地动作不足 */
  warnings: string[];
  summary: string;
}

/** 根据用户输入生成一份训练计划 */
export function generatePlan(input: PlanInput): GeneratedPlan {
  const bmi = calcBmi(input.heightCm, input.weightKg);
  const { sets, reps } = setScheme(input.level, bmi);
  const durationSec = durationFor(input.level, bmi);
  const warnings: string[] = [];

  const muscles = input.muscles.length > 0 ? input.muscles : ['Chest'];
  const slots = slotsPerMuscle(muscles.length, bmi);

  const chosen: ClassifiedExercise[] = [];
  const used = new Set<string>();
  const locTextFull = input.location === 'home' ? '在家' : '在健身房';

  for (const muscle of muscles) {
    // 提示文案里用中文肌群名，避免界面中英混排
    const zhMuscle = muscleName(muscle);
    // 该部位 + 该场地的候选；若该场地没有，退回全部场地并给出提示
    let pool = classifiedExercises.filter(
      (e) => e.primaryMuscle === muscle && e.location === input.location && !used.has(e.slug),
    );

    if (pool.length === 0) {
      const fallback = classifiedExercises.filter(
        (e) => e.primaryMuscle === muscle && !used.has(e.slug),
      );
      if (fallback.length === 0) {
        warnings.push(`${zhMuscle} 暂无动作，已跳过`);
        continue;
      }
      // 该场地完全没有这个部位的动作（例如内收肌在家为 0），必须说明为什么要替换
      warnings.push(`${zhMuscle}${locTextFull}没有可用的动作，已改用其他场地动作代替`);
      pool = fallback;
    }

    const picked = pick(pool, slots);
    // 只有确实因为数量不足才提示，避免 pool 刚好够用时也报一句「不足」自相矛盾
    if (picked.length < slots) {
      warnings.push(`${zhMuscle} 可用动作不足 ${slots} 个，安排了 ${picked.length} 个`);
    }
    for (const e of picked) {
      used.add(e.slug);
      chosen.push(e);
    }
  }

  // 组装为 WorkoutExercise，直接按目标组数创建，无需再裁剪
  const exercises: WorkoutExercise[] = chosen.map((ex) => {
    const w = createWorkoutExercise(ex, sets);
    const duration = isDurationExercise(ex);
    return {
      ...w,
      sets: w.sets.map((s) =>
        duration ? { ...s, durationSec } : { ...s, reps },
      ),
    };
  });

  const levelText = input.level === 'beginner' ? '新手' : '进阶';
  const summary = `${locTextFull} · ${levelText} · ${exercises.length} 个动作 · 每个 ${sets} 组`;

  // 动作数量明显偏少时补一句总提示，避免用户以为计划「就这么短」
  if (exercises.length > 0 && exercises.length < muscles.length * slots) {
    warnings.push(`本次共 ${exercises.length} 个动作，略少于目标，可到「浏览」页手动补充`);
  }

  return { exercises, bmi, warnings, summary };
}
