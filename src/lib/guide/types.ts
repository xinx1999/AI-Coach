/**
 * 动作教程内容类型。
 *
 * 数据源说明：上游 @bryllim/workout-guide 是纯插图素材库，
 * manifest 里只有 name / equipment / primaryMuscle / exerciseType 等
 * 结构化字段，**没有任何文字教学**。因此这份教程内容由本项目自行编写。
 *
 * 内容定位：写给「看着插图、想确认自己做得对不对」的普通训练者，
 * 不是给教练看的解剖学教材。因此用口语、短句，避免术语堆砌。
 */
export interface ExerciseGuide {
  /** 动作要领，按执行顺序的 3~5 步 */
  steps: string[];
  /** 呼吸节奏，一句话 */
  breathing: string;
  /** 常见错误，2~3 条。每条写「错在哪 + 怎么改」 */
  mistakes: string[];
  /** 安全提示 / 替代做法，1~2 条。无特别风险时可写通用提醒 */
  safety: string[];
}

/** slug → 教程。按肌群分组维护，便于查找与校对。 */
export type GuideMap = Record<string, ExerciseGuide>;

/** 内容版本号：将来修改文案时递增，可用于提示用户内容已更新 */
export const GUIDE_VERSION = 1;
