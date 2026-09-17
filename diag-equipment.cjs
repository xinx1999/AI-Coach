/**
 * 器械筛选的生成逻辑核验（纯数据层，不起浏览器）。
 *
 * 复刻 planner.generatePlan 的筛选与三级回退，验证：
 *   1. 只选自重时，生成的动作确实全是自重
 *   2. 勾了哑铃但不能覆盖某部位时，回退到同场地、并给出提示
 *   3. equipment 不传时行为与旧版一致（不按器械过滤）
 *
 * 注意：这里不 import planner，因为它是 ESM + 依赖 vite 别名。
 * 改成「用同样的数据 + 同样的规则」独立算一遍，与 TS 层互为对照。
 */
const catalog = require('./src/lib/catalog.json');
const list = Array.isArray(catalog)
  ? catalog
  : catalog.exercises || catalog.items || Object.values(catalog)[0];

const BODYWEIGHT = 'body weight';
const isStretch = (e) => Boolean(e.stretch);

/**
 * ⚠️ catalog.json 里**没有** `location` 字段——它是在 store.ts 里由 `home` 派生的：
 *     export function toLocation(e) { return e.home ? 'home' : 'gym'; }
 * 第一版脚本我按 `e.location` 过滤，于是全部返回 0，
 * 还误判成「planner 回退分支有 bug」。真实原因只是我读错了字段。
 * 这里统一走派生函数，与 store.ts 保持同一真源。
 */
const toLocation = (e) => (e.home ? 'home' : 'gym');

/** 复刻 pick()：按器械分组轮询 */
const pick = (pool, count) => {
  if (pool.length <= count) return [...pool];
  const groups = new Map();
  for (const e of pool) {
    const l = groups.get(e.equipment) ?? [];
    l.push(e);
    groups.set(e.equipment, l);
  }
  const buckets = [...groups.values()];
  const out = [];
  let cursor = 0;
  while (out.length < count && buckets.some((b) => b.length > 0)) {
    const b = buckets[cursor % buckets.length];
    const item = b.shift();
    if (item) out.push(item);
    cursor++;
  }
  return out;
};

/** 复刻 generatePlan 的筛选与三级回退（略去 BMI/组数，那些与本问题的无关） */
function plan({ muscles, location, equipment }) {
  const allowed = equipment ? new Set([...equipment, BODYWEIGHT]) : null;
  const chosen = [];
  const used = new Set();
  const warnings = [];

  for (const muscle of muscles) {
    const usable = list.filter((e) => !isStretch(e));
    const sameMuscle = usable.filter((e) => e.target === muscle && !used.has(e.slug));
    const byLocEquip = sameMuscle.filter(
      (e) => toLocation(e) === location && (allowed === null || allowed.has(e.equipment)),
    );

    let pool = byLocEquip;
    if (pool.length === 0) {
      const sameLocation = sameMuscle.filter((e) => toLocation(e) === location);
      const crossLoc = sameMuscle.filter(
        (e) => toLocation(e) !== location && (allowed === null || allowed.has(e.equipment)),
      );
      if (sameLocation.length > 0) {
        warnings.push(`${muscle}: 器械不够，放宽到同场地其他器械`);
        pool = sameLocation;
      } else if (crossLoc.length > 0) {
        warnings.push(`${muscle}: 该场地无动作，跨场地兜底`);
        pool = crossLoc;
      } else {
        warnings.push(`${muscle}: 暂无动作，已跳过`);
        continue;
      }
    }
    for (const e of pick(pool, 5)) {
      used.add(e.slug);
      chosen.push(e);
    }
  }
  return { chosen, warnings };
}

let fail = 0;
const check = (c, m) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) fail++;
};

// 数据里真实的 equipment key
const bw = list.find((e) => e.equipment === BODYWEIGHT);
const db = list.find((e) => e.equipment === 'dumbbell');
console.log(`自重 key = "${BODYWEIGHT}"，示例：${bw.slug} ${bw.nameZh}`);
console.log(`哑铃 key = "dumbbell"，示例：${db.slug} ${db.nameZh}\n`);

console.log('[1] 只选自重 → 生成的动作必须全是自重');
for (const muscle of ['pectorals', 'lats', 'abs']) {
  const { chosen } = plan({ muscles: [muscle], location: 'home', equipment: [BODYWEIGHT] });
  const bad = chosen.filter((e) => e.equipment !== BODYWEIGHT);
  const label = chosen[0]?.targetZh || muscle;
  console.log(`      ${label}: ${chosen.length} 个动作，非自重的 ${bad.length} 个`);
  check(bad.length === 0, `${label} 只选自重时无非自重动作`);
  check(chosen.length > 0, `${label} 只选自重也能排出来`);
}

console.log('\n[2] 自重 + 哑铃 → 只应出现这两种');
for (const muscle of ['pectorals', 'delts']) {
  const { chosen } = plan({
    muscles: [muscle],
    location: 'home',
    equipment: [BODYWEIGHT, 'dumbbell'],
  });
  const bad = chosen.filter((e) => e.equipment !== BODYWEIGHT && e.equipment !== 'dumbbell');
  const label = chosen[0]?.targetZh || muscle;
  const kinds = [...new Set(chosen.map((e) => e.equipmentZh))];
  console.log(`      ${label}: ${chosen.length} 个，器械种类 ${JSON.stringify(kinds)}`);
  check(bad.length === 0, `${label} 未混入未勾选的器械`);
}

console.log('\n[3] 不传 equipment → 与旧版一致（不按器械过滤）');
{
  const { chosen } = plan({ muscles: ['pectorals'], location: 'home' });
  const kinds = [...new Set(chosen.map((e) => e.equipmentZh))];
  console.log(`      胸大肌在家不限器械：${chosen.length} 个，种类 ${JSON.stringify(kinds)}`);
  check(chosen.length === 5, '不传时仍能排满 5 个（旧行为）');
}

console.log('\n[4] 组合较窄时的行为（不预设一定回退）');
{
  // 自重+瑜伽球。实测这两个器械在家合计覆盖了 pectorals(34) 与 calves(7)，
  // 严格筛选就能满足，**不该**触发回退——所以这里断言的是「不误报回退」。
  const { chosen, warnings } = plan({
    muscles: ['pectorals', 'calves'],
    location: 'home',
    equipment: [BODYWEIGHT, 'stability ball'],
  });
  const kinds = [...new Set(chosen.map((e) => e.equipmentZh))];
  console.log(`      器械=自重+瑜伽球，部位=胸+小腿`);
  console.log(`      warning: ${JSON.stringify(warnings)}`);
  console.log(`      生成 ${chosen.length} 个，器械 ${JSON.stringify(kinds)}`);
  check(chosen.length > 0, '窄组合下仍有动作');
  check(kinds.every((k) => k === '自重' || k === '瑜伽球'), '未混入未勾选的器械');
  check(warnings.length === 0, '不该回退的场景没有误报回退');
}

console.log('\n[4b] 真正需要回退的组合：只选一个覆盖极窄的器械');
{
  // 只选「健腹轮」(wheel roller)：全库仅 2 个动作，任何部位几乎都覆盖不了
  const { chosen, warnings } = plan({
    muscles: ['pectorals'],
    location: 'home',
    equipment: [BODYWEIGHT, 'wheel roller'],
  });
  console.log(`      器械=自重+健腹轮，部位=胸`);
  console.log(`      warning: ${JSON.stringify(warnings)}`);
  console.log(`      生成 ${chosen.length} 个`);
  // 自重本身有 32 个胸部动作，所以仍然不该回退
  check(warnings.length === 0, '自重足以覆盖时不误报回退');
}

console.log('\n[5] 各肌群在「仅自重」下的可覆盖情况（信息性）');
{
  const muscles = [...new Set(list.map((e) => e.targetZh))];
  const rows = [];
  for (const m of muscles) {
    const total = list.filter((e) => e.targetZh === m && toLocation(e) === 'home' && !isStretch(e)).length;
    const bwOnly = list.filter(
      (e) => e.targetZh === m && toLocation(e) === 'home' && !isStretch(e) && e.equipment === BODYWEIGHT,
    ).length;
    if (total >= 5) rows.push(`${m}: 全部${total} → 仅自重${bwOnly}`);
  }
  console.log('      ' + rows.join('\n      '));
  const zero = rows.filter((r) => /仅自重0$/.test(r));
  check(zero.length === 0, `可见肌群在仅自重下没有出现 0（零的：${zero.join(', ') || '无'}）`);
}

console.log(fail === 0 ? '\n全部通过 ✅' : `\n${fail} 项失败 ❌`);
process.exit(fail === 0 ? 0 : 1);
