const fs = require('fs');
const path = require('path');

const catalog = require('./src/lib/catalog.json');
const GIF = 'public/media/gif';
const THUMB = 'public/media/thumb';

const missingGif = [];
const missingThumb = [];
const emptyGif = [];

for (const e of catalog) {
  if (!e.gif) missingGif.push(e.nameZh + ' (无字段)');
  else if (!fs.existsSync(path.join(GIF, e.gif))) missingGif.push(e.nameZh + ' ' + e.gif);
  else if (fs.statSync(path.join(GIF, e.gif)).size < 500) emptyGif.push(e.nameZh + ' ' + e.gif);

  if (!e.thumb) missingThumb.push(e.nameZh + ' (无字段)');
  else if (!fs.existsSync(path.join(THUMB, e.thumb))) missingThumb.push(e.nameZh + ' ' + e.thumb);
}

const gifFiles = fs.readdirSync(GIF).length;
const thumbFiles = fs.readdirSync(THUMB).length;

console.log('目录里 entry 数:', catalog.length);
console.log('磁盘上 GIF:', gifFiles, ' 缩略图:', thumbFiles);
console.log('缺失 GIF:', missingGif.length, missingGif.slice(0, 8));
console.log('疑似损坏(过小) GIF:', emptyGif.length, emptyGif.slice(0, 8));
console.log('缺失缩略图:', missingThumb.length, missingThumb.slice(0, 8));

// 顺便核对中文字段完整度
const noZh = catalog.filter((e) => !e.nameZh);
const noSteps = catalog.filter((e) => !e.steps || e.steps.length === 0);
const noTargetZh = catalog.filter((e) => !e.targetZh);
const noEquipZh = catalog.filter((e) => !e.equipmentZh);
const noPartZh = catalog.filter((e) => !e.bodyPartZh);
console.log('\n缺中文名:', noZh.length);
console.log('缺中文步骤:', noSteps.length);
console.log('缺 targetZh:', noTargetZh.length, noTargetZh.slice(0, 5).map((e) => e.target));
console.log('缺 equipmentZh:', noEquipZh.length, noEquipZh.slice(0, 5).map((e) => e.equipment));
console.log('缺 bodyPartZh:', noPartZh.length);

// 度量分布
const byMetric = {};
const byPart = {};
for (const e of catalog) {
  byMetric[e.metric] = (byMetric[e.metric] || 0) + 1;
  byPart[e.bodyPartZh] = (byPart[e.bodyPartZh] || 0) + 1;
}
console.log('\n计量方式:', byMetric);
console.log('部位分布:', byPart);

const total = gifFiles + thumbFiles;
console.log('\n✅ 校验完成');
