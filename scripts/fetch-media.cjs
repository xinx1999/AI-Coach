/**
 * 下载数据集的动作媒体（GIF + 缩略图）。
 *
 * 为什么不用 git clone：整仓 ~200MB，且本机到 GitHub 的 clone 屡次超时中断（跑了 12 分钟只有 9KB）。
 * 直接从 raw.githubusercontent.com 逐个取文件更快，而且每个文件都能单独重试/跳过，
 * 已存在的文件直接跳过 —— 中断后重新跑即可续上。
 *
 * 并发 12 路。GIF 平均 100KB 左右，1324 个约 150MB。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

// 路径全部相对仓库根：clone 下来就能直接跑，不依赖作者本机的绝对路径。
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'scripts/exercises.json');
const OUT_GIF = path.join(ROOT, 'public/media/gif');
const OUT_THUMB = path.join(ROOT, 'public/media/thumb');
const BASE = 'https://raw.githubusercontent.com/Devillmy/exercises-dataset-zh/main/';
const CONCURRENCY = 12;
const RETRY = 4;

if (!fs.existsSync(DATA)) {
  console.error(`缺少数据清单：${DATA}`);
  console.error('请先执行 scripts/fetch-dataset.cjs 下载 exercises.json。');
  process.exit(1);
}

const exercises = JSON.parse(fs.readFileSync(DATA, 'utf8'));

// 建立任务队列：每条约 1 个 gif + 1 个缩略图
const jobs = [];
for (const ex of exercises) {
  if (ex.gif_url) jobs.push({ url: BASE + ex.gif_url, out: path.join(OUT_GIF, path.basename(ex.gif_url)) });
  if (ex.image) jobs.push({ url: BASE + ex.image, out: path.join(OUT_THUMB, path.basename(ex.image)) });
}

for (const dir of [OUT_GIF, OUT_THUMB]) fs.mkdirSync(dir, { recursive: true });

function download(url, out, attempt = 0) {
  return new Promise((resolve) => {
    // 已下载过就跳过（支持中断续跑）
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return resolve({ skipped: true });

    const tmp = out + '.part';
    const file = fs.createWriteStream(tmp);
    const req = https.get(url, { timeout: 45000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(tmp);
        return download(res.headers.location, out, attempt).then(resolve);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tmp); } catch {}
        return retryOrFail(url, out, attempt, resolve, 'HTTP ' + res.statusCode);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmp, out);
            resolve({ ok: true, size: fs.statSync(out).size });
          } catch (e) {
            resolve({ fail: e.message });
          }
        });
      });
    });
    req.on('timeout', () => { req.destroy(); });
    req.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(tmp); } catch {}
      retryOrFail(url, out, attempt, resolve, e.message);
    });
  });
}

function retryOrFail(url, out, attempt, resolve, why) {
  if (attempt < RETRY) {
    setTimeout(() => download(url, out, attempt + 1).then(resolve), 500 * (attempt + 1));
  } else {
    resolve({ fail: why, url });
  }
}

(async () => {
  let done = 0, skipped = 0, failed = [];
  let cursor = 0;
  const t0 = Date.now();

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const r = await download(job.url, job.out);
      if (r.skipped) skipped++;
      else if (r.ok) done++;
      else failed.push({ url: job.url, why: r.fail });
      const n = done + skipped + failed.length;
      if (n % 50 === 0 || n === jobs.length) {
        const sec = ((Date.now() - t0) / 1000).toFixed(0);
        process.stdout.write(`  ${n}/${jobs.length}  新下载 ${done}  跳过 ${skipped}  失败 ${failed.length}  ${sec}s\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n完成：新下载 ${done}，跳过 ${skipped}，失败 ${failed.length}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failed.length) {
    console.log('失败清单（前 20）:');
    failed.slice(0, 20).forEach((f) => console.log('  ' + f.url + '  <- ' + f.why));
    fs.writeFileSync(path.join(ROOT, 'scripts/failed.json'), JSON.stringify(failed, null, 2));
  }
  console.log('GIF 数量:', fs.readdirSync(OUT_GIF).length, '| 缩略图数量:', fs.readdirSync(OUT_THUMB).length);
})();
