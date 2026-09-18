/**
 * 全量 GIF 帧率统计（只读文件头 + GCE 块，不解析像素）。
 *
 * 只读前若干字节即可拿到帧数与延时 —— 1324 个文件全量 readFileSync 会很慢。
 * 延时信息都在文件前部的 GCE 块里，读 200KB 足够。
 *
 * 背景知识（判断「卡顿」成因的关键）：
 *  - GIF 延时单位是 **1/100 秒**（cs），必须是整数。
 *  - 浏览器历史规则：延时 < 2cs（20ms，>50fps）会被当作 10cs（100ms）。
 *    → 「源文件明明 60fps 却像幻灯片」的经典原因。
 *  - 若延时普遍是 100cs（1 秒/帧），那是**源数据本身就慢**，与播放无关。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function scan(file) {
  const fd = fs.openSync(file, 'r');
  const len = fs.fstatSync(fd).size;
  const buf = Buffer.alloc(Math.min(len, 200 * 1024));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  if (buf.slice(0, 3).toString('ascii') !== 'GIF') return null;

  const packed = buf[10];
  let p = 13 + ((packed & 0x80) ? 3 * Math.pow(2, (packed & 7) + 1) : 0);
  const delays = [];
  let frames = 0;
  let truncated = false;

  while (p < buf.length) {
    const b = buf[p];
    if (b === 0x3b) break;
    if (b === 0x21) {
      if (buf[p + 1] === 0xf9) {
        delays.push(buf.readUInt16LE(p + 4));
        const size = buf[p + 2];
        p += 3 + size;
        while (p < buf.length && buf[p] !== 0) p += buf[p] + 1;
        p += 1;
        continue;
      }
      p += 2;
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1;
      p += 1;
      continue;
    }
    if (b === 0x2c) {
      frames++;
      const lp = buf[p + 9];
      p += 10 + ((lp & 0x80) ? 3 * Math.pow(2, (lp & 7) + 1) : 0);
      p += 1;
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1;
      p += 1;
      continue;
    }
    p++;
    if (p >= buf.length - 1) { truncated = true; break; }
  }

  const totalCs = delays.reduce((a, b) => a + b, 0);
  return {
    kb: Math.round(len / 1024),
    frames,
    ms: totalCs * 10,
    fps: totalCs > 0 ? frames / (totalCs / 100) : 0,
    delays,
    truncated,
  };
}

const dir = process.argv[2] || path.join(__dirname, 'public', 'media', 'gif');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gif'));

const all = [];
for (const f of files) {
  const r = scan(path.join(dir, f));
  if (r) all.push(r);
}

const n = all.length;
const avg = (k) => all.reduce((a, b) => a + b[k], 0) / n;

console.log(`\n全量 ${n} 个 GIF\n`);
console.log(`  平均帧数     ${avg('frames').toFixed(1)}`);
console.log(`  平均时长     ${avg('ms').toFixed(0)}ms`);
console.log(`  平均有效fps  ${avg('fps').toFixed(2)}`);
console.log(`  平均体积     ${avg('kb').toFixed(0)}KB`);
console.log(`  总体积       ${(avg('kb') * n / 1024).toFixed(1)}MB`);

const buckets = { 'fps<4': 0, '4-6': 0, '6-10': 0, '10-15': 0, '15-20': 0, '>=20': 0 };
for (const r of all) {
  const f = r.fps;
  if (f < 4) buckets['fps<4']++;
  else if (f < 6) buckets['4-6']++;
  else if (f < 10) buckets['6-10']++;
  else if (f < 15) buckets['10-15']++;
  else if (f < 20) buckets['15-20']++;
  else buckets['>=20']++;
}
console.log('\n帧率分布:');
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${k.padEnd(8)} ${String(v).padStart(4)} 个  ${(v / n * 100).toFixed(1).padStart(5)}%  ${'█'.repeat(Math.round(v / n * 40))}`);
}

const dh = {};
for (const r of all) for (const d of new Set(r.delays)) dh[d] = (dh[d] || 0) + 1;
console.log('\n延时值分布 (cs；100cs = 1 秒):');
for (const [k, v] of Object.entries(dh).sort((a, b) => a[0] - b[0]).slice(0, 14)) {
  const cs = Number(k);
  const note = cs >= 50 ? '  ← 长帧，卡顿的直接来源' : cs < 2 ? '  ← 会被浏览器改写为 10cs' : '';
  console.log(`  ${String(cs).padStart(4)}cs (${String(cs * 10).padStart(4)}ms)  ${String(v).padStart(4)} 个文件${note}`);
}

const longFiles = all.filter((r) => r.delays.length && r.delays.filter((d) => d >= 50).length / r.delays.length > 0.3).length;
console.log(`\n含大量(>30%)长延时帧(≥500ms)的文件: ${longFiles} 个 (${(longFiles / n * 100).toFixed(1)}%)`);
console.log(`帧数 ≤ 12 的文件: ${all.filter((r) => r.frames <= 12).length} 个`);
console.log(`帧数 ≥ 24 的文件: ${all.filter((r) => r.frames >= 24).length} 个`);
