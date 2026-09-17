import type { ExerciseGuide, GuideMap } from './types';
import { GUIDE_VERSION } from './types';

import { CORE_GUIDES } from './core';
import { GLUTE_GUIDES } from './glutes';
import { QUAD_GUIDES } from './quads';
import { CHEST_GUIDES } from './chest';
import { SHOULDER_GUIDES } from './shoulders';
import { BACK_GUIDES } from './back';
import { TRICEP_GUIDES } from './triceps';
import { HAMSTRING_GUIDES } from './hamstrings';
import { LAT_GUIDES } from './lats';
import { LEG_GUIDES } from './legs';
import { BICEP_GUIDES } from './biceps';
import { FOREARM_GUIDES, REAR_DELT_GUIDES } from './forearms';
import {
  UPPER_BACK_GUIDES,
  CALF_GUIDES,
  POSTERIOR_CHAIN_GUIDES,
  MOBILITY_GUIDES,
  LOWER_BACK_GUIDES,
  ADDUCTOR_GUIDES,
  HIP_GUIDES,
} from './upper-back';

/**
 * 全部动作教程的合并表。
 *
 * 维护约定：新增或修改教程时，在对应肌群文件里改条目即可。
 * 合并顺序不影响查找结果——slug 全局唯一，由 check-guides.cjs 校验：
 *   node check-guides.cjs
 * 该脚本会比对上游 manifest 的 302 个 slug，报告「漏写 / 多写 / 重复」。
 */
export const ALL_GUIDES: GuideMap = {
  ...CORE_GUIDES,
  ...GLUTE_GUIDES,
  ...QUAD_GUIDES,
  ...CHEST_GUIDES,
  ...SHOULDER_GUIDES,
  ...BACK_GUIDES,
  ...TRICEP_GUIDES,
  ...HAMSTRING_GUIDES,
  ...LAT_GUIDES,
  ...LEG_GUIDES,
  ...BICEP_GUIDES,
  ...FOREARM_GUIDES,
  ...REAR_DELT_GUIDES,
  ...UPPER_BACK_GUIDES,
  ...CALF_GUIDES,
  ...POSTERIOR_CHAIN_GUIDES,
  ...MOBILITY_GUIDES,
  ...LOWER_BACK_GUIDES,
  ...ADDUCTOR_GUIDES,
  ...HIP_GUIDES,
};

/** 查找某个动作的教程。没有对应内容时返回 undefined，由调用方决定如何降级。 */
export function getGuide(slug: string): ExerciseGuide | undefined {
  return ALL_GUIDES[slug];
}

/** 该动作是否有教程内容 */
export function hasGuide(slug: string): boolean {
  return slug in ALL_GUIDES;
}

/** 已编写的教程条目数 */
export const GUIDE_COUNT = Object.keys(ALL_GUIDES).length;

export { GUIDE_VERSION };
export type { ExerciseGuide, GuideMap };
