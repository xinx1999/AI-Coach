/**
 * 统一测试入口：起 preview → 依次跑所有 e2e / verify 套件 → 汇总。
 *
 * ## 为什么要这个
 *
 * 仓库里有 11 个 e2e + 3 个 verify 套件，但 `package.json` 里没有 test 脚本，
 * 也没有 CI 跑它们 —— 于是它们只能靠人手工一个个 `node xxx.cjs`。
 * 手工跑的下场就是慢慢没人跑，等真出问题时已经不知道是怎么坏的。
 * 这个 runner 把「起服务 → 跑 → 关服务」收拢成一条命令。
 *
 * ## 为什么不写进 package.json 的依赖
 *
 * playwright 依赖见 e2e-setup.cjs 顶部的说明：它是可选依赖，CI 构建不跑浏览器，
 * 不想让每次 `npm install` 都拉几十 MB chromium。所以这里也只是探测，不新增依赖。
 *
 * ## 端口
 *
 * 统一用 4199（多数套件的默认值），并通过 BASE 传给所有子进程。
 * 少数脚本默认 5173，但它们都读 process.env.BASE，所以传了就一致。
 * （e2e-wizard.cjs 原先是纯硬编码 5173，已改为支持 BASE。）
 *
 * 用法：
 *   node e2e-run-all.cjs            # 跑全部
 *   node e2e-run-all.cjs regression # 只跑名字含 regression 的
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const ROOT = __dirname;

/** 要跑的套件。e2e-setup 是公共库不是测试；verify-live 打的是线上站点，不在此列。 */
const SUITES = [
  'e2e-equipment.cjs',
  'e2e-landing.cjs',
  'e2e-optimize.cjs',
  'e2e-plan-loc.cjs',
  'e2e-player.cjs',
  'e2e-pwa.cjs',
  'e2e-redesign.cjs',
  'e2e-regression.cjs',
  'e2e-responsive.cjs',
  'e2e-trend.cjs',
  'e2e-wizard.cjs',
  'verify-backlog.cjs',
  'verify-fix.cjs',
  'verify-media.cjs',
];

/**
 * 拼 NODE_PATH —— e2e 脚本直接 require('playwright-core')，
 * 而 playwright 不一定装在项目里（见 e2e-setup.cjs）。
 * 把存在的候选目录都塞进去，子进程就能解析到。
 */
function computeNodePath() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData/Roaming/npm/node_modules/playwright/node_modules'),
    path.join(home, 'AppData/Roaming/npm/node_modules'),
    path.join(
      home,
      '.workbuddy-ai/plugins/cache/codebuddy-plugins-official/playwright-cli/0.1.0/node_modules',
    ),
  ];
  const found = candidates.filter((c) => fs.existsSync(c));
  return found.join(path.delimiter);
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = require('http').get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await httpOk(BASE)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    // POSIX：负 pid 杀进程组
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* 已经没了 */
    }
    // Windows：进程组那招不灵，补一刀
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 从套件输出里抓总结行：支持「结果：全部通过」「N 项失败」「X passed」等常见写法 */
function summarize(stdout) {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-4);
  const hit = tail.find((l) =>
    /全部通过|项失败|失败|passed|failed|PASS|FAIL/i.test(l),
  );
  if (hit) return hit.replace(/\s+/g, ' ').slice(0, 70);
  return lines.length ? lines[lines.length - 1].slice(0, 70) : '(无输出)';
}

function runSuite(file, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000, // 单个套件上限 3 分钟
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      resolve({
        file,
        code,
        ms: Date.now() - started,
        summary: summarize(out),
        output: out,
      });
    });
    child.on('error', (err) => {
      resolve({ file, code: 1, ms: Date.now() - started, summary: String(err.message), output: '' });
    });
  });
}

(async () => {
  const filter = process.argv[2];
  const matched = filter ? SUITES.filter((s) => s.includes(filter)) : SUITES;

  if (!matched.length) {
    console.error(`没有匹配「${filter}」的套件。可选：\n  ${SUITES.join('\n  ')}`);
    process.exit(1);
  }

  // 缺文件的当「跳过」而不是失败：这些套件是可选的
  // （部分曾被 .gitignore 的 e2e-*.cjs 通配吃掉），
  // fresh clone 下少一两个不该让整轮测试挂掉 —— 但要在汇总里说清楚。
  const missing = matched.filter((s) => !fs.existsSync(path.join(ROOT, s)));
  const suites = matched.filter((s) => fs.existsSync(path.join(ROOT, s)));
  if (missing.length) {
    console.log(`\n跳过 ${missing.length} 个（文件不存在）：${missing.join(', ')}`);
  }
  if (!suites.length) {
    console.error('\n没有任何套件可跑。\n');
    process.exit(1);
  }

  // 必须有构建产物，preview 才有东西可服务
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('\ndist/index.html 不存在 —— 先跑一次：npm run build\n');
    process.exit(1);
  }

  const NODE_PATH = computeNodePath();
  if (!NODE_PATH) {
    console.error(
      '\n找不到 playwright-core 的候选路径。安装方式见 e2e-setup.cjs 的顶部注释。\n',
    );
    process.exit(1);
  }

  console.log(`\n启动 preview @ ${BASE} …`);
  const viteBin = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, NODE_PATH },
    stdio: 'ignore',
    detached: true,
  });

  let serverUp = false;
  try {
    serverUp = await waitForServer();
    if (!serverUp) {
      console.error(`\npreview 没能在 30 秒内就绪（端口 ${PORT} 被占用？）\n`);
      process.exit(1);
    }

    const env = { ...process.env, BASE, NODE_PATH };
    console.log(`跑 ${suites.length} 个套件\n`);

    const results = [];
    for (const s of suites) {
      process.stdout.write(`  ${s.padEnd(24)} … `);
      const r = await runSuite(s, env);
      results.push(r);
      const mark = r.code === 0 ? '✓' : '✗';
      console.log(`${mark} ${(r.ms / 1000).toFixed(1)}s  ${r.summary}`);
    }

    const failed = results.filter((r) => r.code !== 0);
    console.log('\n' + '─'.repeat(60));
    console.log(`总计 ${results.length} 个套件：${results.length - failed.length} 通过，${failed.length} 失败`);
    if (failed.length) {
      console.log('\n失败套件：');
      for (const f of failed) console.log(`  ✗ ${f.file}  ${f.summary}`);
      console.log('\n（要看完整输出：node ' + failed[0].file + '）');
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (serverUp) killTree(server);
  }
})();