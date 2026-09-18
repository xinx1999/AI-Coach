/**
 * GIF 帧结构与延时分析。
 *
 * 为什么不用现成库：GIF 的帧延时存在 Graphic Control Extension 里，
 * 解析它只需要几十行，装个依赖反而更麻烦。
 *
 * 关键背景：GIF 的延时单位是 **1/100 秒**，而且是整数。
 * 浏览器还有个历史遗留规则 —— **延时 < 2（即 20ms，约 50fps）会被当作 10（100ms）**。
 * 这是「明明看着有几十帧，播出来却一顿一顿」的常见根因。
 */
const fs = require('fs');
const path = require('path');

function analyze(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(0, 3).toString('ascii') !== 'GIF') return null;

  const w = buf.readUInt16LE(6);
  const h = buf.readUInt16LE(8);
  const packed = buf[10];
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = gctFlag ? 3 * Math.pow(2, (packed & 0x07) + 1) : 0;

  let p = 13 + gctSize;
  const delays = [];
  let frames = 0;
  let transparent = 0;
  let disposal = {};

  // 逐块扫描
  while (p < buf.length) {
    const b = buf[p];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const label = buf[p + 1];
      if (label === 0xf9) {
        // Graphic Control Extension
        const size = buf[p + 2];
        const flags = buf[p + 3];
        const delay = buf.readUInt16LE(p + 4);
        const tFlag = (flags & 0x01) !== 0;
        const disp = (flags >> 2) & 0x07;
        delays.push(delay);
        if (tFlag) transparent++;
        disposal[disp] = (disposal[disp] || 0) + 1;
        p += 3 + size;
        // 跳过后续子块
        while (buf[p] !== 0) p += buf[p] + 1;
        p += 1;
        continue;
      }
      // 其它扩展：跳子块
      p += 2;
      while (buf[p] !== 0) p += buf[p] + 1;
      p += 1;
      continue;
    }
    if (b === 0x2c) {
      frames++;
      const lpacked = buf[p + 9];
      const lctFlag = (lpacked & 0x80) !== 0;
      const lctSize = lctFlag ? 3 * Math.pow(2, (lpacked & 0x07) + 1) : 0;
      p += 10 + lctSize;
      p += 1; // LZW min code size
      while (buf[p] !== 0) p += buf[p] + 1;
      p += 1;
      continue;
    }
    p++;
  }

  const totalCs = delays.reduce((a, b) => a + b, 0);
  const unique = [...new Set(delays)].sort((a, b) => a - b);
  // 浏览器：delay < 2 会被替换成 10
  const clamped = delays.filter((d) => d < 2).length;

  return {
    file: path.basename(file),
    dim: `${w}x${h}`,
    kb: Math.round(buf.length / 1024),
    frames,
    durationMs: totalCs * 10,
    avgDelayCs: frames ? +(totalCs / frames).toFixed(2) : 0,
    effFps: totalCs ? +(frames / (totalCs / 100)).toFixed(1) : 0,
    uniqueDelays: unique.slice(0, 8),
    clampedCount: clamped,
    transparent,
    disposal,
  };
}

const dir = process.argv[2] || path.join(__dirname, 'public', 'media', 'gif');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gif'));

// 抽样：前 5 个 + 随机 15 个
const sample = [...files.slice(0, 5)];
const step = Math.max(1, Math.floor(files.length / 15));
for (let i = 0; i < files.length && sample.length < 20; i += step) {
  if (!sample.includes(files[i])) sample.push(files[i]);
}

console.log(`\n目录: ${dir}`);
console.log(`总数: ${files.length}\n`);

const rows = [];
for (const f of sample) {
  const r = analyze(path.join(dir, f));
  if (r) rows.push(r);
}

console.log('文件                          尺寸      体积    帧数  总时长   平均延时  有效fps  唯一延时值');
console.log('-'.repeat(112));
for (const r of rows) {
  console.log(
    r.file.padEnd(30) +
    r.dim.padEnd(10) +
    (r.kb + 'KB').padEnd(8) +
    String(r.frames).padEnd(6) +
    (r.durationMs + 'ms').padEnd(9) +
    (r.avgDelayCs + 'cs').padEnd(10) +
    String(r.effFps).padEnd(9) +
    JSON.stringify(r.uniqueDelays)
  );
}

// 汇总
const all = files.map((f) => analyze(path.join(dir, f))).filter(Boolean);
const avgFrames = all.reduce((a, b) => a + b.frames, 0) / all.length;
const avgDuration = all.reduce((a, b) => a + b.durationMs, 0) / all.length;
const avgFps = all.filter((a) => a.effFps > 0).reduce((a, b) => a + b.effFps, 0) / all.filter((a) => a.effFps > 0).length;
const withClamp = all.filter((a) => a.clampedCount > 0).length;
const delayHist = {};
for (const a of all) for (const d of a.uniqueDelays) delayHist[d] = (delayHist[d] || 0) + 1;

console.log('\n' + '='.repeat(60));
console.log(`全量统计（${all.length} 个文件）`);
console.log('='.repeat(60));
console.log(`  平均帧数:     ${avgFrames.toFixed(1)}`);
console.log(`  平均总时长:   ${avgDuration.toFixed(0)}ms`);
console.log(`  平均有效fps:  ${avgFps.toFixed(1)}`);
console.log(`  含 <2cs 延时的文件: ${withClamp} 个 (${(withClamp / all.length * 100).toFixed(1)}%)`);
console.log(`  延时值分布:   ${JSON.stringify(Object.fromEntries(Object.entries(delayHist).sort((a, b) => a[0] - b[0]).slice(0, 12)))}`);
console.log(`  平均体积:     ${(all.reduce((a, b) => a + b.kb, 0) / all.length).toFixed(0)}KB`);
