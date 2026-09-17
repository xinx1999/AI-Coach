/**
 * 下载数据集清单（exercises.json 与中文名映射）。
 *
 * 数据来源：https://github.com/Devillmy/exercises-dataset-zh
 *   - data/exercises.json —— 全部 1324 个动作的结构化数据（含 10 语种说明），约 17MB
 *   - data/name_zh.json   —— 英文名 → 中文名的映射
 *
 * ⚠️ 上游把这两个文件移到了 `data/` 子目录（媒体在 `videos/` 与 `images/`）。
 * 旧路径（仓库根）现在返回 404，会让「开箱即用」直接失败 —— CI 里表现为构建中断。
 *
 * 这两个文件不进版本库（体量与媒体同理），但生成产物 src/lib/catalog.json 是入库的，
 * 因此日常开发并不需要跑这个脚本；只有在数据集更新、需要重新生成 catalog 时才用，
 * 以及 CI 里需要在没有媒体的情况下重建时用。
 *
 * 用法：node scripts/fetch-dataset.cjs
 * 特点：支持断点续传（curl -C -），网络抖动时重跑即可。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BASE = 'https://raw.githubusercontent.com/Devillmy/exercises-dataset-zh/main/';

const FILES = [
  { url: BASE + 'data/exercises.json', out: path.join(HERE, 'exercises.json') },
  { url: BASE + 'data/name_zh.json', out: path.join(HERE, 'name_zh.json') },
];

for (const { url, out } of FILES) {
  const name = path.basename(out);
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  console.log(`\n→ ${name}${size ? `（已有 ${(size / 1024 / 1024).toFixed(1)}MB，尝试续传）` : ''}`);
  try {
    execFileSync(
      'curl',
      ['-L', '-C', '-', '--retry', '10', '--retry-all-errors', '--retry-delay', '2', '-o', out, url],
      { stdio: 'inherit' },
    );
  } catch (e) {
    console.error(`  ${name} 下载中断：${e.message}`);
    console.error('  直接重跑本脚本即可从断点继续。');
    process.exit(1);
  }

  // 下完立刻验一次 JSON 可解析 —— 半截文件最典型的症状就是 parse 失败
  try {
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    const n = Array.isArray(data) ? data.length : Object.keys(data).length;
    console.log(`  ✓ ${name} 可解析，${n} 条`);
  } catch (e) {
    console.error(`  ✗ ${name} 解析失败（多半是文件不完整）：${e.message}`);
    console.error('  重跑本脚本继续下载。');
    process.exit(1);
  }
}

console.log('\n数据集清单已就绪。');
console.log('下一步：node scripts/build-catalog.cjs   重新生成 src/lib/catalog.json');
console.log('        node scripts/fetch-media.cjs     下载动作演示媒体（约 138MB）');
