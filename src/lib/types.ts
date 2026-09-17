export type ExerciseType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'duration'
  | 'distance_duration'
  | 'assisted_bodyweight';

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  exerciseType: ExerciseType;
  equipment: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  isStretch: boolean;
  frames: [
    { index: 1; path: string },
    { index: 2; path: string },
    { index: 3; path: string },
  ];
}

export interface SetsRep {
  id: string;
  setNumber: number;
  /** 计划次数（训练前的意图） */
  reps?: number;
  /** 计划重量 kg（训练前的意图） */
  weight?: number;
  /** 计划时长（秒），时长类动作用 */
  durationSec?: number;
  /** 计划距离（米），有氧类动作用（跑步、骑行、划船机…） */
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
