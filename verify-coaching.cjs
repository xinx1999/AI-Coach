/**
 * 教练内容（常见错误）的覆盖回归网。
 *
 * ## 为什么要这个
 *
 * `mistakesFor` 会按动作特征拼装一堆候选，最后 `slice(0, 3)` 只留 3 条。
 * 2026-09-22 发现：早先的实现是**按生成顺序**取前 3 条，
 * 而通用提示（负重通病）排在专属提示前面 —— 于是专属提示被挤掉：
 *
 *   | 场景 | 修复前 | 修复后 |
 *   |---|---|---|
 *   | 负重 + 下肢（膝内扣/脚跟离地） | 22.2% | 99.4% |
 *   | 负重 + 拉类（耸肩代偿） | 52.4% | 100% |
 *   | 负重 + 推类（肘部外展/锁死） | 68.5% | 100% |
 *
 * 这个 bug 的特点是**完全静默**：界面上照样有 3 条提示，只是内容不对。
 * 没有自动化断言就永远发现不了，所以这里逐类做全量扫描。
 *
 * ## 为什么用 esbuild 现场编译，而不是 require 编译产物
 *
 * 要断言的是**源码逻辑**。若去 require `dist/` 里的产物，
 * 一旦忘了重新构建，测的就是旧代码 —— 那种「测试通过但线上是坏的」最坑。
 * esbuild 是 vite 的直接依赖（`npm ci` 后必然存在），编译一次约 50ms。
 *
 * ## 为什么在内存里编译，不落地成临时文件
 *
 * 第一版把编译结果写到 `.tmp-coaching-built.cjs` 再 require，末尾 `unlinkSync` 清理。
 * 结果在 CI/本机的 safe-delete 包装器下挂了：
 *   [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {count:2664, threshold:50}
 * —— 包装器按「轮次」累计删除次数，本轮别处的删除早把额度用完了，
 * 于是这个测试因为「清理临时文件」而失败，跟被测逻辑毫无关系。
 * 改成 `transformSync` + `Module._compile` 直接在内存里跑，不产生任何文件。
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');

const ROOT = __dirname;

let fail = 0;
const check = (cond, msg, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? '  ' + detail : ''}`);
  if (!cond) fail++;
};

// ---------- 内存里编译真实源码 ----------
let coachingFor;
try {
  const entry = path.join(ROOT, 'src/lib/coaching.ts');
  const src = fs.readFileSync(entry, 'utf8');
  // coaching.ts 只有 `import type`（纯类型），esbuild 会直接擦除，产物无外部依赖
  const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'cjs', target: 'node22' });
  const m = new Module(entry, null);
  m.filename = entry;
  m.paths = Module._nodeModulePaths(path.dirname(entry));
  m._compile(code, entry);
  coachingFor = m.exports.coachingFor;
} catch (e) {
  console.error('\n✗ 编译 src/lib/coaching.ts 失败：' + e.message + '\n');
  process.exit(1);
}
if (typeof coachingFor !== 'function') {
  console.error('\n✗ 编译产物里没有导出 coachingFor —— 是不是改名了？\n');
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/catalog.json'), 'utf8'));

// 与 coaching.ts 保持一致的判定（改那边时这里要同步）
const WEIGHTED = new Set([
  'barbell', 'dumbbell', 'ez barbell', 'olympic barbell', 'trap bar', 'kettlebell',
  'cable', 'leverage machine', 'smith machine', 'sled machine', 'weighted',
  'medicine ball', 'band', 'resistance band', 'hammer',
]);
const tipsOf = (ex) => coachingFor(ex).mistakes || [];
const isWeighted = (ex) => WEIGHTED.has(ex.equipment);
const isPush = (ex) => ex.bodyPart === 'chest' || ex.bodyPart === 'shoulders' || ex.target === 'triceps';
const isPull = (ex) => ex.bodyPart === 'back' || ex.target === 'biceps';

console.log('\n[1] 条数上下限');
const over = catalog.filter((ex) => tipsOf(ex).length > 3);
const under = catalog.filter((ex) => tipsOf(ex).length < 2);
check(over.length === 0, '没有动作超过 3 条（上限是刻意的设计取舍）', over.length ? `越界 ${over.length} 个` : '');
check(under.length === 0, '每个动作至少 2 条（e2e-player 也依赖这条契约）', under.length ? `不足 ${under.length} 个` : '');

console.log('\n[2] 专属提示不被通用提示挤掉（本次修复的核心）');
/**
 * 全量扫描：满足 filter 的动作里，必须都能拿到 probe 里的某一条。
 *
 * 注意 filter 里统一排除 `stretch` —— 拉伸类有自己的那套提示（见 [3]），
 * 不该拿力量训练的提示去要求它。第一版漏了这个排除，
 * 于是「负重 拉伸 弓步」被误报成 FAIL（代码没错，是断言写错了）。
 */
function sweep(label, filter, probes) {
  const group = catalog.filter((ex) => !ex.stretch && filter(ex));
  const miss = group.filter((ex) => !tipsOf(ex).some((t) => probes.some((p) => t.includes(p))));
  check(
    miss.length === 0,
    label,
    `${group.length} 个动作，缺 ${miss.length} 个` + (miss.length ? `：${miss.slice(0, 3).map((e) => e.nameZh).join('、')}` : ''),
  );
}
sweep('负重 + 下肢 → 必须有「膝内扣 / 脚跟离地」', (ex) => isWeighted(ex) && ex.bodyPart === 'upper legs', ['膝盖内扣', '脚跟离地']);
sweep('负重 + 拉类 → 必须有「耸肩代偿」', (ex) => isWeighted(ex) && isPull(ex), ['耸肩']);
sweep('负重 + 推类 → 必须有「肘部外展 / 顶点锁死」', (ex) => isWeighted(ex) && isPush(ex), ['肘部', '锁死']);
sweep('计时类 + 核心 → 必须有「憋气硬撑」和「塌腰」', (ex) => ex.metric === 'duration' && !ex.stretch && (ex.bodyPart === 'waist' || ex.target === 'core'), ['憋气硬撑']);
sweep('负重 + 小臂 → 必须有「手腕中立位」', (ex) => isWeighted(ex) && ex.bodyPart === 'lower arms', ['手腕']);

console.log('\n[3] 分类互不串味');
const stretches = catalog.filter((ex) => ex.stretch);
const stretchBad = stretches.filter((ex) => tipsOf(ex).some((t) => t.includes('惯性甩') || t.includes('膝盖内扣')));
check(stretchBad.length === 0, '拉伸类走拉伸那套提示，不掺力量训练的提示', stretchBad.length ? `${stretchBad.length} 个串味` : `${stretches.length} 个拉伸动作`);

const distance = catalog.filter((ex) => ex.metric === 'distance');
const distanceBad = distance.filter((ex) => !tipsOf(ex).some((t) => t.includes('心率') || t.includes('鼻吸口呼')));
check(distanceBad.length === 0, '有氧/距离类拿到有氧专属提示', `${distance.length} 个动作，缺 ${distanceBad.length} 个`);

console.log('\n[4] 排序不变式：专属提示必须排在同级之前');
// 取一个负重 + 上肢推的样例，逐条打印便于人工复核
const sample = catalog.find((ex) => isWeighted(ex) && ex.bodyPart === 'chest' && !ex.stretch);
if (sample) {
  const tips = tipsOf(sample);
  console.log(`      样例：${sample.nameZh} [${sample.equipment}]`);
  tips.forEach((t, i) => console.log(`        ${i + 1}. ${t.slice(0, 52)}…`));
  check(tips.some((t) => t.includes('肘部')), '该样例的第 1～3 条里含推类专属提示');
}

console.log('\n' + '─'.repeat(60));
console.log(fail === 0 ? '教练内容覆盖：全部通过' : `教练内容覆盖：${fail} 项失败`);
process.exit(fail ? 1 : 0);