// 该脚本从 @bryllim/workout-guide 的 manifest 生成精简版动作索引。
// 生成物 src/lib/catalog.json 只保留应用真正用到的字段：
//   丢弃 frames（图片路径可由 slug 推导）与 attribution（302 个动作共用同一份署名信息，
//   每次内联会导致 creativecommons.org 等字符串在产物中重复上千次）。
// 署名信息单独放在 src/lib/attribution.ts，见 CC BY-SA 4.0 的要求。
// 用法：node scripts/build-catalog.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const manifestPath = resolve(root, 'node_modules/@bryllim/workout-guide/manifest.json');
const outPath = resolve(root, 'src/lib/catalog.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const list = Array.isArray(manifest) ? manifest : manifest.exercises;

const slim = list.map((e) => ({
  slug: e.slug,
  name: e.name,
  type: e.exerciseType,
  eq: e.equipment,
  muscle: e.primaryMuscle,
  secondary: e.secondaryMuscles,
  stretch: e.isStretch,
}));

// 顺带统计：确认所有动作的署名/许可一致，这样才能安全地抽成公共常量
const creators = new Set(list.map((e) => e.attribution?.creator));
const licenses = new Set(list.map((e) => e.attribution?.license));
if (creators.size !== 1 || licenses.size !== 1) {
  throw new Error(
    `署名不一致，无法抽成公共常量。creators=${[...creators]} licenses=${[...licenses]}`,
  );
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(slim), 'utf8');

const before = JSON.stringify(list).length;
const after = JSON.stringify(slim).length;
console.log(`manifest: ${(before / 1024).toFixed(1)} KB -> catalog: ${(after / 1024).toFixed(1)} KB`);
console.log(`压缩到 ${((after / before) * 100).toFixed(1)}%，共 ${slim.length} 个动作`);
console.log(`署名统一：${[...creators][0]} / ${[...licenses][0]}`);
