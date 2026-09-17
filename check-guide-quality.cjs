/**
 * 教程内容质量校验。
 *
 * check-guides.cjs 只校验「slug 是否对齐」，本脚本进一步校验「内容是否达标」：
 *   - 每个条目四个字段齐全且非空
 *   - steps 3~5 条，每条有足够信息量
 *   - breathing 是完整句子
 *   - mistakes 2~3 条（与 UI 的展示预期一致）
 *   - safety 1~2 条
 *   - 文案里不出现「待补充」「TODO」「XXX」之类的占位符
 *
 * 实现方式：不 import TS，而是用正则把每个条目的字段块切出来再做结构检查。
 * 这样零依赖、可直接用 node 跑。
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/work/AI/strong/trainer';
const GUIDE_DIR = path.join(ROOT, 'src', 'lib', 'guide');
const MANIFEST = path.join(ROOT, 'node_modules', '@bryllim', 'workout-guide', 'manifest.json');

const upstream = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).map((e) => e.slug);

const files = fs
  .readdirSync(GUIDE_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts');

/** 把一个文件里的所有顶层条目切成 { slug, body } */
function splitEntries(src) {
  const out = [];
  const re = /^ {2}(?:'([^']+)'|([A-Za-z_][\w-]*)):\s*\{\n([\s\S]*?)^ {2}\},?$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ slug: m[1] || m[2], body: m[3], file: null });
  }
  return out;
}

/**
 * 从条目 body 里取出某个数组字段的所有字符串项。
 *
 * 需要同时支持两种写法：
 *   mistakes: ['a', 'b']        ← 单行
 *   mistakes: [\n      'a',\n    ]  ← 多行
 * 早期只写了多行分支，导致大量单行 safety 被误判为「缺失」。
 */
function arrayField(body, name) {
  const start = new RegExp(`${name}:\\s*\\[`, 'm');
  const sm = start.exec(body);
  if (!sm) return null;

  // 从 '[' 开始做括号配对，找出数组结束位置（内容里没有嵌套数组/中括号）
  let i = sm.index + sm[0].length - 1;
  let depth = 0;
  let end = -1;
  for (; i < body.length; i++) {
    const c = body[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  const inner = body.slice(sm.index + sm[0].length, end);
  const items = [];
  const ire = /'((?:[^'\\]|\\.)*)'/g;
  let im;
  while ((im = ire.exec(inner)) !== null) items.push(im[1]);
  return items;
}

/** 取出单行字符串字段（breathing 是单行） */
function stringField(body, name) {
  const re = new RegExp(`${name}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm');
  const m = body.match(re);
  return m ? m[1] : null;
}

const PLACEHOLDER = /待补|待填|TODO|TBD|XXX|FIXME|占位|示例文案/;

let total = 0;
const problems = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(GUIDE_DIR, f), 'utf8');
  for (const e of splitEntries(src)) {
    total++;
    const label = `${f} → ${e.slug}`;
    const steps = arrayField(e.body, 'steps');
    const breathing = stringField(e.body, 'breathing');
    const mistakes = arrayField(e.body, 'mistakes');
    const safety = arrayField(e.body, 'safety');

    if (!steps) problems.push(`${label}: 缺 steps`);
    else {
      if (steps.length < 3 || steps.length > 5)
        problems.push(`${label}: steps ${steps.length} 条（应 3~5）`);
      steps.forEach((s, i) => {
        if (s.trim().length < 8) problems.push(`${label}: steps[${i}] 过短：「${s}」`);
      });
    }

    if (!breathing) problems.push(`${label}: 缺 breathing`);
    else if (breathing.trim().length < 6)
      problems.push(`${label}: breathing 过短：「${breathing}」`);

    if (!mistakes) problems.push(`${label}: 缺 mistakes`);
    else {
      if (mistakes.length < 2 || mistakes.length > 3)
        problems.push(`${label}: mistakes ${mistakes.length} 条（应 2~3）`);
      mistakes.forEach((s, i) => {
        if (s.trim().length < 10) problems.push(`${label}: mistakes[${i}] 过短：「${s}」`);
      });
    }

    if (!safety) problems.push(`${label}: 缺 safety`);
    else {
      if (safety.length < 1 || safety.length > 2)
        problems.push(`${label}: safety ${safety.length} 条（应 1~2）`);
      safety.forEach((s, i) => {
        if (s.trim().length < 10) problems.push(`${label}: safety[${i}] 过短：「${s}」`);
      });
    }

    // 占位符检查：整个 body
    if (PLACEHOLDER.test(e.body)) problems.push(`${label}: 含占位符文案`);
  }
}

console.log('=== 教程内容质量校验 ===');
console.log(`上游动作         : ${upstream.length}`);
console.log(`解析到的条目     : ${total}`);
console.log('');

if (problems.length === 0) {
  console.log(`OK ${total} 条内容全部符合结构要求`);
  process.exit(0);
}

console.log(`!! 发现 ${problems.length} 个问题：`);
const show = problems.slice(0, 60);
for (const p of show) console.log('   ' + p);
if (problems.length > show.length)
  console.log(`   ... 另有 ${problems.length - show.length} 条未显示`);
process.exit(1);
