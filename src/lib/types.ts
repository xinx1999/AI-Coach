/**
 * 动作的唯一计量方式。
 *
 * 由数据集的结构化字段推断（见 .dsdata/build-catalog.cjs），不靠动作名猜：
 *   - reps     次数类：绝大多数力量动作
 *   - duration 计时类：平板支撑、悬挂、拉伸
 *   - distance 距离类：跑步、骑行、划船等
 */
export type Metric = 'reps' | 'duration' | 'distance';

export interface SecondaryMuscle {
  en: string;
  zh: string;
}

/**
 * 一个动作。
 *
 * 数据来源：Devillmy/exercises-dataset-zh（MIT 许可，媒体 © Gym visual）。
 * 中文字段（nameZh / targetZh / steps…）来自数据集自带内容，不是本项目自撰，
 * 因此不再需要「待专业校对」的免责标注。
 */
export interface Exercise {
  /** 数据集内的稳定 ID，同时用作 slug */
  id: string;
  slug: string;
  /** 英文名，保留用于检索（很多用户会打英文） */
  name: string;
  /** 中文名。数据集中 100% 覆盖，可能为空时前端回落 name */
  nameZh: string | null;
  metric: Metric;
  equipment: string;
  equipmentZh: string;
  bodyPart: string;
  bodyPartZh: string;
  /** 主要目标肌肉 */
  target: string;
  targetZh: string;
  /** 主要协同肌群 */
  muscleGroup: string;
  muscleGroupZh: string;
  secondary: SecondaryMuscle[];
  /** 是否拉伸/放松动作，与力量训练分开呈现 */
  stretch: boolean;
  /** 是否适合在家做（自重、哑铃、弹力带、瑜伽球等） */
  home: boolean;
  /** 动画 GIF 文件名（public/media/gif/ 下） */
  gif: string | null;
  /** 180×180 缩略图文件名（public/media/thumb/ 下） */
  thumb: string | null;
  /** 中文分步说明 */
  steps: string[];
  // 这里原本还有 `instructions`，已删除：它全量等于 steps.join(' ')（1318/1318），
  // 是纯冗余，单独占 catalog 的 51%。需要整段文案时用 steps.join(' ')。
}

export interface SetsRep {
  id: string;
  setNumber: number;
  /** 计划次数（训练前的意图） */
  reps?: number;
  /** 计划重量 kg（训练前的意图） */
  weight?: number;
  /** 计划时长（秒），计时类动作用 */
  durationSec?: number;
  /** 计划距离（米），距离类动作用 */
  distanceM?: number;
  /**
   * 实际完成次数 / 重量。
   *
   * 与上面的计划值分开存：计划是「打算做多少」，实际是「真的做了多少」。
   * 只留计划值的话，用户训练中加重了、少做了一次都无处记录，
   * 「渐进超负荷」就没有依据，下次该练多重只能靠回忆。
   * 未填写时表示与计划一致，展示处回落到计划值。
   */
  actualReps?: number;
  actualWeight?: number;
  /** 实际时长（秒）/ 实际距离（米），与上面的实际次数同理 */
  actualDurationSec?: number;
  actualDistanceM?: number;
  completed: boolean;
  completedAt?: string;
}

export interface WorkoutExercise {
  exercise: Exercise;
  slug: string;
  sets: SetsRep[];
}

export type TimerMode = 'work' | 'rest';

export interface WorkoutSession {
  name: string;
  notes: string;
  exercises: WorkoutExercise[];
  startedAt: string;
  completedAt?: string;
}

export type Screen = 'timer' | 'browse' | 'plan' | 'build' | 'history';

export type TimerTab = 'guided' | 'interval';
