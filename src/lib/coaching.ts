/**
 * 动作提示：呼吸节奏 + 常见错误。
 *
 * ## 为什么是「生成」而不是「从数据集读」
 *
 * 数据集里这两块信息几乎是空的 —— 全量 1318 个动作里，
 * 只有 11% 的步骤文本提到呼吸，0.8% 提到注意事项。而这恰恰是新手最容易做错的地方：
 * 憋气、甩重量、塌腰、关节锁死，光看图看不出来。
 *
 * ## 生成依据
 *
 * 呼吸部分不是拍脑袋编的，是从数据集**已有的** 291 句呼吸描述里反推出的规律：
 *   发力（向心收缩）时呼气，回放（离心收缩）时吸气。
 * 这是力量训练的标准做法（避免瓦氏动作导致的血压骤升，也让核心在发力时更稳）。
 * 已有的句子 100% 符合这条规律，所以按它生成出来的文案风格和数据集是一致的。
 *
 * 计时类、拉伸类、有氧类另按各自的项目惯例处理，见下面各分支注释。
 *
 * ## 边界
 *
 * 这是**通用运动原则**，不是针对个人身体状况的医嘱。
 * 有心血管问题、孕期、术后康复等情况另说 —— 界面上要保留这句提醒，
 * 不能让用户以为这是普适的医疗建议。
 */

import type { Exercise } from './types';

export interface CoachingTip {
  /** 呼吸节奏，一句话 */
  breathing: string;
  /** 常见错误，每条含「错误做法 → 应该怎么做」 */
  mistakes: string[];
}

/** 按器械分组的负重动作，用于判断「是否需要强调控制离心」 */
const WEIGHTED_EQUIPMENT = new Set([
  'barbell',
  'dumbbell',
  'ez barbell',
  'olympic barbell',
  'trap bar',
  'kettlebell',
  'cable',
  'leverage machine',
  'smith machine',
  'sled machine',
  'weighted',
  'medicine ball',
  'band',
  'resistance band',
  'hammer',
]);

/** 需要核心稳定的站姿复合动作，优先提示塌腰/憋气 */
const CORE_CRITICAL_PARTS = new Set(['waist', 'back', 'upper legs', 'chest']);

function isWeighted(ex: Exercise): boolean {
  return WEIGHTED_EQUIPMENT.has(ex.equipment);
}

/** 呼吸节奏。按计量方式分三类，与数据集已有文案的用词保持一致 */
function breathingFor(ex: Exercise): string {
  // 计时类（平板支撑、悬挂、静蹲）：目标是维持姿势，呼吸要匀不能憋
  if (ex.metric === 'duration') {
    if (ex.stretch) {
      return '保持缓慢自然的呼吸，不要憋气；呼气时可以试着再放松一点、幅度再大一点。';
    }
    return '全程匀速呼吸，不要憋气 —— 憋气会让血压骤升，也会让你更早力竭。';
  }

  // 拉伸/放松：呼吸本身就是放松手段
  if (ex.stretch) {
    return '缓慢深呼吸，在呼气时逐渐加大拉伸幅度；有牵拉感即可，出现刺痛就退回一点。';
  }

  // 距离类（跑步、骑行、划船）：按步频/踏频配呼吸，不适用向心离心
  if (ex.metric === 'distance') {
    return '保持能说短句的呼吸节奏（大致三步一吸、三步一呼）。喘到说不出话说明强度过高。';
  }

  // 次数类：发力呼气、回放吸气。有数据集的 291 句原文佐证
  if (isWeighted(ex)) {
    return '发力（举起 / 拉近）时呼气，回放（放下 / 还原）时吸气。回放阶段放慢、控制在 2 秒左右，不要顺着重量自由落体。';
  }
  return '发力时呼气，还原时吸气，不要憋气。';
}

/**
 * 常见错误。按动作特征拼装，只给这个动作真正容易犯的，不套模板刷条目。
 *
 * ## 为什么按「具体度」排序，而不是按生成顺序
 *
 * 最后只保留 3 条。早先的实现是**按生成顺序**取前 3 条，
 * 而生成顺序是「负重通病 → 核心 → 部位专属 → 兜底」——
 * 两条通用的负重提示永远排在最前面，把部位专属的挤掉了。
 *
 * 实测（2026-09-22，全量 1318 条）：
 *   - 负重 + 下肢：只有 **22.2%** 拿到「膝内扣 / 脚跟离地」
 *     （`upper legs` 同时命中核心集 → 负重 2 条 + 塌腰 1 条就占满 3 格）
 *   - 负重 + 拉类：**52.4%** 拿到「耸肩代偿」
 *   - 负重 + 推类：**68.5%**，而**自重**推类（对照组）有 **88.8%**
 *     —— 差距全来自那两条通用负重提示的占位
 *
 * 也就是说，注释写着「只留最相关的 3 条」，实现留的却是「最先入队的 3 条」。
 * 现在按具体度分级：部位/目标肌群专属 → 计量方式专属 → 核心 → 负重通病 → 兜底。
 * 同级别保持原顺序。**条数上限仍是 3** —— 那是当初有意的设计取舍，不动。
 */
function mistakesFor(ex: Exercise): string[] {
  // rank 越小越具体，越该优先保留
  const RANK_SPECIFIC = 0;
  const RANK_CORE = 1;
  const RANK_WEIGHTED = 2;
  const RANK_FALLBACK = 3;

  const out: { text: string; rank: number }[] = [];
  const add = (text: string, rank: number) => out.push({ text, rank });
  const weighted = isWeighted(ex);

  // 拉伸类单独一套：它的问题和力量训练完全不同
  if (ex.stretch) {
    add('弹震式地上下压 —— 应该保持静止拉伸，靠呼吸逐渐加深，弹震容易拉伤。', RANK_SPECIFIC);
    add('拉到刺痛还硬扛 —— 应该是明显的牵拉感但不痛，痛就是过量了。', RANK_SPECIFIC);
    if (ex.metric === 'duration') {
      add('憋着气数秒 —— 应该匀速呼吸，呼气时再推进一点幅度。', RANK_SPECIFIC);
    }
    return out.map((t) => t.text);
  }

  // 有氧/距离类
  if (ex.metric === 'distance') {
    add('一开始就冲太快 —— 应该前 5 分钟慢速热身，让心率平稳爬升。', RANK_SPECIFIC);
    add('呼吸全靠嘴急促吸 —— 应该鼻吸口呼、配合节奏，避免岔气。', RANK_SPECIFIC);
    return out.map((t) => t.text);
  }

  // 计时类静力动作（平板支撑等）：憋气是它最高发的问题，算专属级
  if (ex.metric === 'duration') {
    add('憋气硬撑 —— 应该匀速呼吸，宁可缩短时间也别憋气。', RANK_SPECIFIC);
  }

  // 推类动作（胸、肩、三头）：肘部外展和锁死
  if (ex.bodyPart === 'chest' || ex.bodyPart === 'shoulders' || ex.target === 'triceps') {
    add('肘部张得太开（接近 90° 外展）—— 应该让肘部与身体成 45° 左右，肩关节压力小得多。', RANK_SPECIFIC);
    add('在顶点把关节锁死 —— 应该留一点微屈，让肌肉持续吃力而不是让骨头承重。', RANK_SPECIFIC);
  }

  // 拉类动作（背、二头）：耸肩和用腰甩
  if (ex.bodyPart === 'back' || ex.target === 'biceps') {
    add('耸肩用斜方肌代偿 —— 应该先把肩胛骨下沉、固定住，再发力拉起。', RANK_SPECIFIC);
  }

  // 下肢：膝内扣和脚跟离地
  if (ex.bodyPart === 'upper legs' || ex.bodyPart === 'lower legs') {
    add('膝盖内扣 —— 应该让膝盖始终对准脚尖方向，这对保护膝关节很重要。', RANK_SPECIFIC);
    add('脚跟离地、重心前移到脚尖 —— 应该踩实全脚掌，把重心压在足中。', RANK_SPECIFIC);
  }

  // 腕/小臂类
  if (ex.bodyPart === 'lower arms') {
    add('手腕过度弯折 —— 应该让手腕保持中立位，和前臂成一条直线。', RANK_SPECIFIC);
  }

  // 站姿 / 核心参与的动作：塌腰和关节锁死是高发问题
  if (CORE_CRITICAL_PARTS.has(ex.bodyPart) || ex.target === 'core') {
    add('塌腰或弓背代偿 —— 应该收紧腹部、保持脊柱中立，宁可减重量也不要变形。', RANK_CORE);
  }

  // 负重动作的通病：借力、失控
  if (weighted) {
    add('靠惯性甩起来 —— 应该全程控制，尤其回放阶段慢放 2 秒，甩起来的重量练不到目标肌肉。', RANK_WEIGHTED);
    add('回放直接松劲自由落体 —— 应该主动控制着放回去，离心阶段才是长肌肉的关键。', RANK_WEIGHTED);
  }

  // 兜底：任何动作都不该做到力竭为止
  add('为了凑次数做到力竭变形 —— 应该在姿势开始走形时停下，最后一两次的质量比总数更重要。', RANK_FALLBACK);

  // 稳定排序（同 rank 保持原顺序），只留最相关的 3 条，多了用户不会看完
  return out
    .map((t, i) => ({ ...t, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, 3)
    .map((t) => t.text);
}

/**
 * 取一个动作的呼吸与错误提示。
 *
 * 结果按 slug 缓存 —— 目录页会同时渲染很多张卡片，
 * 每次都重算这套分支是浪费。
 */
const cache = new Map<string, CoachingTip>();

export function coachingFor(ex: Exercise): CoachingTip {
  const hit = cache.get(ex.slug);
  if (hit) return hit;

  const tip: CoachingTip = {
    breathing: breathingFor(ex),
    mistakes: mistakesFor(ex),
  };
  cache.set(ex.slug, tip);
  return tip;
}

/** 界面上必须保留的免责说明 —— 这是通用原则，不是个人医嘱 */
export const COACHING_DISCLAIMER =
  '以上为通用动作原则。有心血管疾病、孕期、术后康复或关节伤病史，请先咨询医生或康复师。';
