/**
 * 教程覆盖率校验脚本。
 *
 * 用途：把 src/lib/guide/*.ts 里实际写出的 slug 与上游 manifest 的 302 个 slug 做差集，
 * 找出「漏写」和「多写（拼错的 slug）」两类问题。
 *
 * 为什么不用 import 而是正则扫描源码：
 * 这些 .ts 文件无法直接被 node 直接执行（tsx 未安装），
 * 而文档结构非常简单（顶层 key 后跟冒号），正则足够可靠且零依赖。
 */
const fs = require('fs');
const path = require('path');

// 注意：用绝对路径。脚本通过注入的 node 执行时 __dirname 不稳定，
// 曾经解析到工作区根目录而不是 trainer/，导致找不到 manifest。
const ROOT = 'D:/work/AI/strong/trainer';
const GUIDE_DIR = path.join(ROOT, 'src', 'lib', 'guide');
const MANIFEST = path.join(ROOT, 'node_modules', '@bryllim', 'workout-guide', 'manifest.json');

// 1) 上游全部 slug
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const upstream = new Set(manifest.map((e) => e.slug));

// 2) 扫描 guide 目录下所有 .ts（排除 types.ts 和 index.ts）
function extractSlugs(src) {
  const slugs = new Set();
  // 只匹配顶层条目：两个空格缩进 + key + 冒号
  const re = /^ {2}(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w-]*)):\s*\{/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    slugs.add(m[1] || m[2] || m[3]);
  }
  return slugs;
}

const files = fs
  .readdirSync(GUIDE_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts');

const perFile = {};
const written = new Set();
const dupes = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(GUIDE_DIR, f), 'utf8');
  const slugs = extractSlugs(src);
  perFile[f] = slugs;
  for (const s of slugs) {
    if (written.has(s)) dupes.push(s);
    written.add(s);
  }
}

// 3) 差集
const missing = [...upstream].filter((s) => !written.has(s));
const orphan = [...written].filter((s) => !upstream.has(s));

// 4) 输出
console.log('=== 教程覆盖率 ===');
console.log(`上游动作总数 : ${upstream.size}`);
console.log(`已写教程条目 : ${written.size}`);
console.log(`覆盖率       : ${((written.size / upstream.size) * 100).toFixed(1)}%`);
console.log('');

const sorted = Object.entries(perFile).sort((a, b) => b[1].size - a[1].size);
for (const [f, s] of sorted) {
  console.log(`  ${f.padEnd(20)} ${s.size} 条`);
}

console.log('');
if (dupes.length) {
  console.log(`!! 重复定义的 slug（${dupes.length}）：`);
  console.log('   ' + dupes.join(', '));
} else {
  console.log('OK 无重复 slug');
}

if (missing.length) {
  console.log('');
  console.log(`!! 漏写 ${missing.length} 个：`);
  for (const s of missing) console.log('   ' + s);
} else {
  console.log('OK 全部动作已覆盖');
}

if (orphan.length) {
  console.log('');
  console.log(`!! 多出的 slug（上游不存在，可能是拼写错误）${orphan.length} 个：`);
  for (const s of orphan) console.log('   ' + s);
} else {
  console.log('OK 无多余 slug');
}

process.exit(missing.length || orphan.length || dupes.length ? 1 : 0);
