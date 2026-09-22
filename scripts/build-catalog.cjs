/**
 * 从 exercises-dataset-zh 生成前端用的 catalog。
 *
 * 数据源：Devillmy/exercises-dataset-zh（MIT，媒体 © Gym visual）
 *   - data/exercises.json      1324 条动作，含 10 语言说明
 *   - data/name_zh.json        1318 条中文名
 *
 * 产出：src/lib/catalog.json
 *
 * 设计取舍：
 * 1. 只保留中文。源数据带 10 种语言，全带进来会让 JSON 从 ~1MB 涨到 17MB，
 *    对纯前端 SPA 不可接受。中文是本项目唯一需要的语言。
 * 2. 媒体只存文件名，不存完整路径 —— 路径前缀由前端拼，换 CDN 时不用重新生成。
 * 3. 动作类型（计量方式）由结构化字段推断，不靠动作名猜。
 *    - body_part === 'cardio'           → 有氧，按距离+时间
 *    - equipment 是纯计时器械            → 按时间
 *    - 名字含 stretch/mobility/circles  → 拉伸，按时间
 *    - 其余                             → 按次数
 *    名称匹配一律用词边界，否则 "crunch" 会被 "run" 命中（踩过）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'scripts');
const OUT = path.join(ROOT, 'src/lib/catalog.json');

/**
 * 分步说明单独出一个文件，不放进 catalog.json。
 *
 * 为什么：`steps` 一个字段就占 catalog 的 **42.8%**（469KB raw / 72KB gzip），
 * 但**只有详情页和计时页用得上**（GuidePanel / ExercisePlayer）——
 * 浏览列表、筛选、搜索、生成计划全都用不到它。
 * 把它留在 catalog.json 里，等于每次首屏都要下载+解析 1318 个动作的完整步骤，
 * 只为渲染一个 60 张卡片的列表。
 *
 * 拆出去后首屏 JS 从 245.5KB gzip 降到约 165KB（−33%），
 * 这个文件由 src/lib/steps.ts 在启动时异步加载（见那里的说明）。
 *
 * 放 public/ 而不是 src/：走 fetch 而不是打进 bundle，才能真的延后。
 * 注意 public/ 下的文件不做哈希，靠 SW 的 /assets/ 规则之外单独缓存 —— 
 * 但它在 `assets/` 之外，SW 的策略要能覆盖到（见 public/sw.js）。
 */
const OUT_STEPS = path.join(ROOT, 'public/catalog-steps.json');

const raw = JSON.parse(fs.readFileSync(path.join(SRC, 'exercises.json'), 'utf8'));
const nameZh = JSON.parse(fs.readFileSync(path.join(SRC, 'name_zh.json'), 'utf8'));

// ---- 中文映射表：肌群 / 器械 / 部位 ----
// 这些词表同时用于筛选器和标签，必须人手核对，不能机翻
const MUSCLE_ZH = {
  abs: '腹肌', hipflexors: '髋屈肌', lowerback: '下背', obliques: '腹斜肌',
  pectorals: '胸大肌', serratusanterior: '前锯肌', biceps: '肱二头肌',
  triceps: '肱三头肌', forearms: '前臂', wrists: '手腕', delts: '三角肌',
  'rear delts': '三角肌后束', lats: '背阔肌', traps: '斜方肌', 'upper back': '上背',
  spine: '竖脊肌', glutes: '臀部', quads: '股四头肌', hamstrings: '腘绳肌',
  calves: '小腿', abductors: '外展肌', adductors: '内收肌', 'hip flexors': '髋屈肌',
  'lower back': '下背', 'cardiovascular system': '心肺', core: '核心',
  'rotator cuff': '肩袖', 'levator scapulae': '肩胛提肌', sternocleidomastoid: '胸锁乳突肌',
  ankles: '踝关节', feet: '足部', hands: '手部', knees: '膝关节',
  'upper chest': '上胸', 'lower chest': '下胸', 'middle back': '中背',
  rhomboids: '菱形肌', shins: '胫骨前肌', grip: '握力',

  // 以下 19 条来自 secondary_muscles 里用的另一套同义词。
  // 数据集的 target 用 pectorals/quads，secondary 里却用 chest/quadriceps，
  // 两套词表混用，所以必须都覆盖，否则标签会中英混杂。
  shoulders: '三角肌', deltoids: '三角肌', 'rear deltoids': '三角肌后束',
  trapezius: '斜方肌', 'latissimus dorsi': '背阔肌', back: '背部', chest: '胸部',
  abdominals: '腹肌', quadriceps: '股四头肌', brachialis: '肱肌',
  'wrist flexors': '腕屈肌', 'wrist extensors': '腕伸肌', 'grip muscles': '握力肌群',
  'lower abs': '下腹', groin: '腹股沟', soleus: '比目鱼肌',
  'ankle stabilizers': '踝关节稳定肌', 'inner thighs': '大腿内侧',
};
const EQUIP_ZH = {
  'body weight': '自重', dumbbell: '哑铃', cable: '绳索', barbell: '杠铃',
  'leverage machine': '器械', band: '弹力带', 'smith machine': '史密斯机',
  kettlebell: '壶铃', weighted: '负重', 'stability ball': '瑜伽球',
  'ez barbell': '曲杠', assisted: '辅助', 'sled machine': '雪橇',
  'medicine ball': '药球', rope: '绳索', roller: '滚轴',
  'resistance band': '弹力带', 'bosu ball': '波速球', 'olympic barbell': '奥杆',
  'wheel roller': '健腹轮', 'upper body ergometer': '上肢功率车',
  'skierg machine': '滑雪测功机', hammer: '锤', 'stationary bike': '固定单车',
  tire: '轮胎', 'elliptical machine': '椭圆机', 'stepmill machine': '踏步机',
  'trap bar': '六角杠', treadmill: '跑步机', 'spinner bike': '动感单车',
};
const BODYPART_ZH = {
  'upper arms': '上臂', 'upper legs': '大腿', back: '背部', waist: '腰腹',
  chest: '胸部', shoulders: '肩部', 'lower legs': '小腿', 'lower arms': '前臂',
  cardio: '有氧', neck: '颈部',
};

const zh = (map, key, fallbackPrefix) => {
  if (!key) return '';
  const k = String(key).toLowerCase().trim();
  return map[k] || map[k.replace(/[-\s]+/g, '')] || (fallbackPrefix ? fallbackPrefix + k : key);
};

/** 词边界匹配：避免 crunch 命中 run */
const wordRe = (words) => new RegExp('(^|[^a-z])(' + words.join('|') + ')([^a-z]|$)', 'i');

const TIME_ONLY_EQUIPMENT = new Set([
  'stationary bike', 'elliptical machine', 'stepmill machine',
  'skierg machine', 'upper body ergometer', 'spinner bike',
]);

/** 推断计量方式：这是前端「输入什么」的唯一依据 */
function inferMetric(ex) {
  const name = ex.name.toLowerCase();
  if (ex.body_part === 'cardio') return 'distance';           // 跑步/骑行/划船：距离 + 时间
  if (TIME_ONLY_EQUIPMENT.has(ex.equipment)) return 'duration'; // 纯计时器械：只有时间
  if (wordRe(['stretch', 'mobility', 'circles?']).test(name)) return 'duration'; // 拉伸：按秒计
  if (wordRe(['plank', 'hold', 'wall sit', 'l-?sit', 'isometric', 'hang']).test(name)) return 'duration';
  return 'reps';
}

/** 是否拉伸动作（内容上是「放松」，与力量训练分开） */
function isStretch(ex) {
  return wordRe(['stretch', 'mobility', 'circles?', 'foam roll', 'roll-?out']).test(ex.name.toLowerCase());
}

/** 是否可用自重完成（「在家」筛选的依据之一） */
function isHomeFriendly(ex) {
  const eq = ex.equipment;
  if (eq === 'body weight' || eq === 'band' || eq === 'resistance band') return true;
  if (eq === 'dumbbell' || eq === 'kettlebell' || eq === 'weighted') return true; // 家用哑铃/壶铃常见
  if (eq === 'stability ball' || eq === 'bosu ball' || eq === 'medicine ball') return true;
  if (eq === 'wheel roller' || eq === 'roller' || eq === 'tire') return true;
  return false;
}

// ---- 生成 ----
const seen = new Map();
const out = [];
/** id → steps[]，单独落 OUT_STEPS，不混进 catalog.json */
const stepsById = {};

for (const ex of raw) {
  const nameEn = (ex.name || '').trim();
  if (!nameEn) continue;
  const key = nameEn.toLowerCase();

  // 去重：数据里有同名条目（如 run / run (equipment)），用 id 保证唯一但仍标记
  if (seen.has(key)) continue;
  seen.set(key, ex.id);

  const zhName = nameZh[key] || null;
  const metric = inferMetric(ex);
  const gif = ex.gif_url ? path.basename(ex.gif_url) : null;
  const thumb = ex.image ? path.basename(ex.image) : null;

  // 只保留 steps。数据集的 `instructions` 字段全量等于 steps 用空格拼接
  // （1318/1318 条，零例外），是纯冗余 —— 它单独占了 catalog 的 51%（455KB）。
  // 别再把它加回来：要恢复就用 steps.join(' ')。
  const steps = (ex.instruction_steps && ex.instruction_steps.zh) || [];

  out.push({
    // 只留 slug。原来还有个 `id: ex.id` —— 与 slug 是同一个表达式，纯冗余，
    // 每条约 12 字节（全量 15.8KB raw / 5.0KB gzip）。删掉它需要同时改
    // lib/types.ts 的 Exercise、两个 stepsFor(...) 调用点和两个校验脚本。
    slug: ex.id,                       // 用数据集 id 做稳定的 slug
    name: nameEn,
    nameZh: zhName,
    // 中文名缺失时回落英文，前端统一显示 nameZh
    metric,                            // reps | duration | distance
    equipment: ex.equipment || '',
    equipmentZh: zh(EQUIP_ZH, ex.equipment, ''),
    bodyPart: ex.body_part || '',
    bodyPartZh: zh(BODYPART_ZH, ex.body_part, ''),
    target: ex.target || '',
    targetZh: zh(MUSCLE_ZH, ex.target, ''),
    muscleGroup: ex.muscle_group || '',
    muscleGroupZh: zh(MUSCLE_ZH, ex.muscle_group, ''),
    secondary: (ex.secondary_muscles || []).map((m) => ({
      en: m,
      zh: zh(MUSCLE_ZH, m, ''),
    })),
    stretch: isStretch(ex),
    home: isHomeFriendly(ex),
    gif,
    thumb,
  });

  // steps 不进 catalog.json，单独落盘（理由见 OUT_STEPS）
  // 注意：这里的 key 就是 slug（数据集 id），前端用 `stepsFor(exercise.slug)` 取
  stepsById[ex.id] = steps.filter(Boolean);
}

// 按「部位 → 中文名」排序，让同类动作聚在一起
const PART_ORDER = ['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'cardio', 'neck'];
out.sort((a, b) => {
  const pa = PART_ORDER.indexOf(a.bodyPart), pb = PART_ORDER.indexOf(b.bodyPart);
  if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  return (a.nameZh || a.name).localeCompare(b.nameZh || b.name, 'zh');
});

fs.writeFileSync(OUT, JSON.stringify(out));
fs.writeFileSync(OUT_STEPS, JSON.stringify(stepsById));

// ---- 报告 ----
const stat = (f) => {
  const m = {};
  out.forEach((x) => { const k = f(x) || '(空)'; m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
console.log('总动作数:', out.length, '（源', raw.length, '）');
console.log('缺中文名:', out.filter((x) => !x.nameZh).length);
console.log('缺中文步骤:', Object.values(stepsById).filter((s) => s.length === 0).length);
console.log('缺 GIF:', out.filter((x) => !x.gif).length);
console.log('\n计量方式:', stat((x) => x.metric).map(([k, v]) => k + '=' + v).join('  '));
console.log('拉伸:', out.filter((x) => x.stretch).length, '| 可在家:', out.filter((x) => x.home).length);
console.log('\n部位:', stat((x) => x.bodyPartZh).map(([k, v]) => k + '=' + v).join('  '));
console.log('\n器械(前12):', stat((x) => x.equipmentZh).slice(0, 12).map(([k, v]) => k + '=' + v).join('  '));
console.log('\n目标肌肉(前12):', stat((x) => x.targetZh).slice(0, 12).map(([k, v]) => k + '=' + v).join('  '));
console.log('\n未翻译的 target:', [...new Set(out.filter((x) => x.target && x.targetZh === x.target).map((x) => x.target))].join(', ') || '(无)');
console.log('未翻译的 equipment:', [...new Set(out.filter((x) => x.equipment && x.equipmentZh === x.equipment).map((x) => x.equipment))].join(', ') || '(无)');
console.log('未翻译的肌肉:', [...new Set(out.flatMap((x) => x.secondary.filter((s) => s.zh === s.en).map((s) => s.en)))].join(', ') || '(无)');
console.log('\n产出:', OUT, (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
console.log('产出:', OUT_STEPS, (fs.statSync(OUT_STEPS).size / 1024).toFixed(1), 'KB',
  '（' + Object.keys(stepsById).length + ' 个动作的步骤，首屏不加载）');
