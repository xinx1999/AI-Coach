/**
 * 诊断：为什么「内收肌 + 在家」没有触发回退提示？
 *
 * 预期（planner 注释里写的）：该肌群在该场地无动作时，应回退到另一场地并给出警告。
 * 实测：警告是「动作数量不足」，不是「没有可用的动作，已改用其他场地」。
 *
 * 两个候选假设：
 *   A. 判定用错字段（home 布尔 vs 派生出的 location）
 *   B. 根本没进入回退分支（pool 一开始就不为空）
 *
 * 同时统计「按 home 字段判定」与「按 location 判定」的结果差异，
 * 看是不是两条真源不一致导致的假阴性。
 */
const path = require('path');

const catalog = require('./src/lib/catalog.json');
const list = Array.isArray(catalog)
  ? catalog
  : catalog.exercises || catalog.items || Object.values(catalog)[0];

/**
 * 复刻 store.ts 的判定逻辑（不 import，因为它是 ESM + 依赖 vite 别名）。
 * store.ts: export function toLocation(e) { return e.home ? 'home' : 'gym'; }
 */
const toLocation = (e) => (e.home ? 'home' : 'gym');
const isStretchOnly = (e) => Boolean(e.stretch);

// planner 里的判定（当前代码）
const planField = (e, loc) => (loc === 'home' ? e.home !== false : e.home === false);
// 应该用的判定（与 store 同源）
const planLoc = (e, loc) => toLocation(e) === loc;

const muscles = [...new Set(list.map((e) => e.target))];
const LABEL = {};
list.forEach((e) => {
  if (!LABEL[e.target]) LABEL[e.target] = e.targetZh || e.target;
});

let mismatchTotal = 0;
console.log('肌群 | 场地 | 字段法 | 派生法 | 差异 | planner 是否会回退');
console.log('-'.repeat(78));

for (const m of muscles) {
  for (const loc of ['home', 'gym']) {
    const usable = list.filter((e) => !isStretchOnly(e));
    const byField = usable.filter((e) => e.target === m && planField(e, loc)).length;
    const byLoc = usable.filter((e) => e.target === m && planLoc(e, loc)).length;
    const diff = byField - byLoc;
    if (diff !== 0) {
      mismatchTotal += diff;
      // planner 里判 pool.length===0 才回退；用字段法算出 >0 就永远不回退
      const wouldFallback = byField === 0;
      console.log(
        `${(LABEL[m] || m).padEnd(6)} | ${loc.padEnd(4)} | ${String(byField).padStart(5)} | ${String(
          byLoc,
        ).padStart(5)} | ${String(diff).padStart(4)} | ${wouldFallback ? '会' : '不会（BUG）'}`,
      );
    }
  }
}

console.log('-'.repeat(78));
console.log(`字段法与派生法的条目差异合计：${mismatchTotal}`);

console.log('\n=== 是否真的存在「该肌群在该场地为 0」的情况 ===');
let zeroCases = 0;
for (const m of muscles) {
  for (const loc of ['home', 'gym']) {
    const usable = list.filter((e) => !isStretchOnly(e));
    const byLoc = usable.filter((e) => e.target === m && planLoc(e, loc)).length;
    if (byLoc === 0) {
      zeroCases++;
      console.log(`  ${LABEL[m] || m} @ ${loc} = 0 → 本应回退并提示`);
    }
  }
}
if (zeroCases === 0) console.log('  无（所以回退分支在当前数据下本来就不可达）');

console.log('\n=== 结论 ===');
if (mismatchTotal > 0) {
  console.log('字段法与派生法结果不一致 → planner 的 filter 用错了字段。');
  console.log('后果：该回退时不回退，静默给出空结果，回退警告与 .wizard-plan-loc');
  console.log('的「由其他场地补入」提示都不会出现。');
} else {
  console.log('两种判定一致，问题不在字段。');
}
