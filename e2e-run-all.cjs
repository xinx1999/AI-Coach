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
 *
 * **没有候选路径时返回空字符串，且调用方不许因此报错。**
 * 这些候选全是 Windows 的路径，在 CI（ubuntu）上一个都不存在；
 * 但那里 playwright 是装进项目 node_modules 的，node 自己就能解析，
 * 根本不需要 NODE_PATH。空值只意味着「交给默认的模块解析」。
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

/**
 * 预检：脚本里不许再出现硬编码的浏览器绝对路径。
 *
 * ## 为什么必须有这条
 *
 * 2026-09-22 之前，11 个套件各自抄了一份
 *   C:/Users/Admin/AppData/Local/ms-playwright/.../chrome-headless-shell.exe
 * 在 Windows 上那个文件真实存在 → 本地 14 个套件全绿；
 * 在 ubuntu CI 上不存在 → chromium.launch() 立刻抛错，test job 连挂两次。
 * 而 GitHub 的 job logs 端点要 admin 权限（403），拿不到报错，
 * 只能靠「本地绿、CI 红 + 失败点在第 3 个套件」这种侧面线索反推，排查成本极高。
 *
 * 统一走 e2e-setup.cjs 之后，这条预检负责不让它复活 ——
 * 写这一行远比再查一次便宜。
 */
function assertNoHardcodedBrowserPath() {
  const BAD = /C:\/Users\/|ms-playwright\/chromium/;
  const files = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith('.cjs') && !f.startsWith('.') && f !== 'e2e-run-all.cjs');
  const offenders = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      // 注释里提到这个路径是允许的（本文件上面就在提），只拦真正的代码行
      const code = l.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      if (BAD.test(l)) offenders.push(`${f}:${i + 1}  ${code.slice(0, 90)}`);
    });
  }
  if (offenders.length) {
    const detail =
      '发现硬编码的浏览器路径 —— 在 ubuntu CI 上必然失败：\n  ' +
      offenders.join('\n  ') +
      '\n\n请改用：const { chromium, executablePath: EXE } = require("./e2e-setup.cjs");';
    console.error('\n✗ ' + detail + '\n');
    // 日志匿名读不到（见 emitFailureAnnotations 的说明），再发一份到注解。
    if (process.env.GITHUB_ACTIONS) {
      const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
      console.log(`::error title=预检失败: 硬编码浏览器路径::${esc(detail).slice(0, 6000)}`);
    }
    process.exit(1);
  }
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

/**
 * 把失败详情写成 GitHub Actions 注解（::error::）。
 *
 * ## 为什么需要这个
 *
 * GitHub 的 job logs 端点要 admin 权限，匿名访问返回
 * `403 Must have admin rights to Repository.` —— 日志正文根本拿不到。
 * 2026-09-22 排查 test job 失败时就被这个卡住，只能靠「本地绿、CI 红」
 * 加失败点位置这种侧面线索反推，绕了很大一圈。
 *
 * 但 **check-runs 的 annotations 接口是匿名可读的**：
 *   GET /repos/{owner}/{repo}/commits/{ref}/check-runs      → 拿 check_run id
 *   GET /repos/{owner}/{repo}/check-runs/{id}/annotations   → 读注解正文
 * （已实测：连 runner 自己发的 Node 20 弃用警告都能读到。）
 *
 * 所以这里把「哪个套件挂了 + 它的尾部输出」写成注解，
 * 等于给自己留了一条能匿名读的通道。注解长度上限很宽松，
 * 但太长了人也看不完，所以每个套件截 6000 字符。
 *
 * 只在 GitHub Actions 环境里发 —— 本地跑时这串东西是噪音。
 */
function emitFailureAnnotations(failed) {
  if (!process.env.GITHUB_ACTIONS) return;
  // 工作流命令的转义：% 必须最先替换，换行用 %0A
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
  for (const f of failed) {
    const tail = f.output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-20)
      .join('\n');
    const body = esc(`${f.summary}\n\n${tail}`).slice(0, 6000);
    console.log(`::error title=套件失败: ${f.file}::${body}`);
  }
  console.log(
    `::error title=e2e 汇总::${esc(`${failed.length} 个套件失败：${failed.map((f) => f.file).join(', ')}`)}`,
  );
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

  // 先拦硬编码路径：它会让「本地绿、CI 红」，而且报错离真实原因很远。
  assertNoHardcodedBrowserPath();

  // 必须有构建产物，preview 才有东西可服务
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('\ndist/index.html 不存在 —— 先跑一次：npm run build\n');
    process.exit(1);
  }

  // 空就空着 —— 见 computeNodePath 的注释：CI 上不需要它。
  // 真找不到 playwright 时，子进程自己会以清晰的错误退出，不需要在这里猜。
  const NODE_PATH = computeNodePath();

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
      for (const f of failed) {
        console.log(`\n  ✗ ${f.file}  ${f.summary}`);
        // CI 上拿不到 job 日志时（需 admin 权限），这几行就是唯一的线索，
        // 所以把套件自己的尾部输出直接打出来，别只留一行摘要。
        const tail = f.output
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-12);
        for (const l of tail) console.log('      │ ' + l.slice(0, 200));
      }
      // 上面这些只进日志；日志匿名读不到，所以再发一份到注解里。
      emitFailureAnnotations(failed);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (serverUp) killTree(server);
  }
})();