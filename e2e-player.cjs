/**
 * 动作演示播放器的端到端验证。
 *
 * ## 为什么必须用真实浏览器跑
 *
 * 播放器的核心是「把 GIF 解码成逐帧位图再画到 canvas」，这条链路里
 * 有两处只在浏览器里才成立、Node 里测不到的东西：
 *   1. canvas 的 getImageData / putImageData 行为
 *   2. omggif 解码出的 RGBA 是否真的画出了人形（解码器用错会得到全透明）
 *
 * 所以这里不只断言「元素存在」，而是**读 canvas 的像素**来确认每一帧
 * 确实有不同的内容 —— 这是唯一能证明「解码 + 合成」正确的方式。
 *
 * ## 界面是零交互的，怎么验
 *
 * 演示区刻意没有任何可点元素（没有控制条，步骤列表也退化成纯文字，见
 * src/components/ExercisePlayer.tsx）。于是所有「点一下看看」的测法都失效了。
 *
 * 剩下两个必须被守住的性质：
 *
 *   1. **剔除定格帧仍在生效** —— 这是流畅度的唯一来源。做法是**定时采样**：
 *      让它自己放，每隔一段时间取一次 canvas 像素指纹，看画面是否一路推进。
 *      若哪天有人把 motionFrameIndices 去掉、改回原始帧序列，采样就会撞上
 *      500ms/1000ms 的定格，出现长串相同指纹，断言报警。
 *
 *   2. **播放节奏仍是原速** —— 做法是**量帧切换间隔**：连续快速采样，
 *      统计「指纹变化」之间的时间差。素材的运动帧是 100ms，原速下就是 ~100ms。
 *
 *      这条断言的价值在于「记录当前选择」：中间一度做成放慢 2 倍（200ms），
 *      后来用户要求「再加快一点」，于是回到原速。断言随之收紧，
 *      以后谁再把 SLOWDOWN 调离 1，这里会失败并逼他确认是不是有意的。
 *      这条断言的价值在于：把 SLOWDOWN 改回 1 或删掉，它会立刻失败。
 *
 * ## 端口约定
 *
 *   5173 = dev，4199 = preview（沿用项目既有约定）
 * 用 BASE 环境变量可指向线上。
 */

/**
 * 目标站点。默认 preview（4199）而不是 dev ——
 * preview 跑的是真实构建产物，能看到 tree-shaking 后的实际行为。
 */
process.env.BASE = process.env.BASE || 'http://localhost:4199';
const { chromium, executablePath, BASE, IS_REMOTE } = require('./e2e-setup.cjs');
const path = require('path');
const fs = require('fs');

let pass = 0;
let fail = 0;
function check(ok, label, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${label}${detail ? `  ${detail}` : ''}`);
  }
}

/** 取 canvas 的像素指纹：用来判断两帧画面是否真的不同 */
async function canvasFingerprint(page, selector) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c || !c.getContext) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    // 不透明像素数 + 简单哈希。不透明像素数能立刻看出「是否解码成了全透明」
    let opaque = 0;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 10) {
        opaque += 1;
        hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) | 0;
      }
    }
    return { opaque, hash, w: c.width, h: c.height };
  }, selector);
}

/**
 * 在**页面内**用 requestAnimationFrame 观测画面变化，返回每次变化的时刻。
 *
 * ⚠️ 这里踩过一个坑，值得写下来：一开始我在 Node 侧用
 * `for (...) { 取指纹; await page.waitForTimeout(40) }` 采样，想用
 * 「指纹变化的间隔」量帧时长，结果量出 47ms —— 看着像「根本没放慢」。
 *
 * 但那是**测法错了，不是代码错了**：每一次「取指纹」都要走一遍 Playwright
 * 的跨进程协议，实测单次往返远超 40ms。于是 `waitForTimeout(40)` 成了摆设，
 * 真正的采样间隔由往返耗时决定（约 47ms 起），
 * 连续两次采样几乎总是落在**不同**的帧上 —— 算出来的「间隔」
 * 不过是协议开销，跟动画速度毫无关系。
 *
 * 正确做法是把观测放进页面里：rAF 与渲染同频，时间戳来自同一个时钟，
 * 既没有协议开销，精度也高得多。
 *
 * 顺带说明：这个坑当时误导性特别强 —— 47ms 与「原速 100ms」同量级，
 * 很容易顺势得出「哦原来本来就接近原速」的错觉。**读数不对时先怀疑测法。**
 */
async function observeFrameChanges(page, selector, durationMs = 4000) {
  return page.evaluate(
    ({ sel, dur }) =>
      new Promise((resolve) => {
        const c = document.querySelector(sel);
        if (!c || !c.getContext) return resolve({ err: 'no-canvas' });
        const ctx = c.getContext('2d');
        const fingerprint = () => {
          const { data } = ctx.getImageData(0, 0, c.width, c.height);
          let hash = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 10) {
              hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) | 0;
            }
          }
          return hash;
        };

        const seen = [];
        let last = null;
        const t0 = performance.now();
        const tick = () => {
          const h = fingerprint();
          if (h !== last) {
            seen.push({ hash: h, t: Math.round(performance.now() - t0) });
            last = h;
          }
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else resolve({ changes: seen });
        };
        tick();
      }),
    { sel: selector, dur: durationMs },
  );
}

(async () => {
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  const isRemote = /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(BASE);
  console.log(`\n目标: ${BASE}${isRemote ? '  (线上)' : '  (本地 preview)'}`);

  // ---------- 1. 打开浏览页，点开第一个动作详情 ----------
  console.log('\n[1] 详情页播放器');
  await page.goto(`${BASE}/#browse`, {
    waitUntil: isRemote ? 'load' : 'networkidle',
    timeout: isRemote ? 90000 : 30000,
  });
  await page.waitForTimeout(isRemote ? 2500 : 800);

  const firstCard = page.locator('.exercise-card').first();
  await firstCard.waitFor({ timeout: 20000 });
  await firstCard.click();
  await page.waitForSelector('.player', { timeout: 15000 });

  check(true, '详情页出现播放器容器');

  // ---------- 2. 解码成功：canvas 有实际画面 ----------
  // 等解码完成（loading 消失），解码是异步 fetch + parse
  await page
    .waitForFunction(() => !document.querySelector('.player-loading'), { timeout: 20000 })
    .catch(() => {});

  const fp0 = await canvasFingerprint(page, '.player-canvas');
  check(fp0 !== null, 'canvas 可读取像素');
  if (fp0) {
    // 关键断言：解码成功的话画面里必然有大量不透明像素（白底 + 人形）。
    // 全透明说明 putImageData 没生效或解码器用错了。
    check(
      fp0.opaque > fp0.w * fp0.h * 0.2,
      '解码出可见画面（非全透明）',
      `不透明像素 ${fp0.opaque} / ${fp0.w * fp0.h}`,
    );
  }

  // ---------- 3. 零交互：演示区内不该有任何可点元素 ----------
  /**
   * 演示区被刻意做成完全不可交互的。这条断言看起来像废话，其实是**这次改造
   * 的核心契约** —— 三次改版逐步砍掉了控制条、再砍掉了可点步骤，
   * 每一次都是「加法容易、减法难」。有了这条断言，以后谁再加回一个按钮
   * 都会在这里失败，而不是等用户抱怨。
   *
   * 注意只查 `.player` 内部：`.demo` 里的收藏 / 关闭按钮是浮层控件，属于别处。
   */
  console.log('\n[2] 零交互');
  const interactive = await page.evaluate(() => {
    const root = document.querySelector('.player');
    if (!root) return { err: 'no-player' };
    const sel = 'button, a, input, select, textarea, [role="button"], [tabindex]';
    const found = Array.from(root.querySelectorAll(sel)).map(
      (el) => `${el.tagName.toLowerCase()}.${el.className || '(no-class)'}`,
    );
    return { found };
  });
  check(
    interactive.err !== 'no-player' && interactive.found.length === 0,
    '演示区内没有任何可点元素（无控制条、步骤不可点）',
    interactive.err === 'no-player' ? '找不到 .player' : `找到 ${interactive.found.length} 个: ${interactive.found.join(', ')}`,
  );

  // 步骤列表应当仍然**渲染出来**，只是退化成纯文字
  const stepCount = await page.locator('.player-step').count();
  check(stepCount >= 4, '步骤说明仍以纯文字展示', `${stepCount} 条`);
  const stepTags = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.player-step')).map((el) => el.tagName.toLowerCase()),
  );
  check(
    stepTags.length > 0 && stepTags.every((t) => t === 'li'),
    '步骤是 li 而不是可点的按钮',
    [...new Set(stepTags)].join(',') || '(空)',
  );

  // ---------- 4. 自动循环：画面推进 + 无定格 + 原速 ----------
  /**
   * 在页面内观测 4 秒，同时验三件事 —— 它们是演示区仅剩的可观测性质：
   *
   *   a) 画面在动        —— 出现多种不同画面
   *   b) 没有定格帧漏网  —— 不出现异常长的一段静止
   *   c) 节奏是原速      —— 帧切换间隔 ≈ 100ms
   *
   * (c) 把 SLOWDOWN 从「一个写在代码里的数字」变成「一个被测量过的行为」。
   * 当前值是 1（用户要求「再加快一点」，从 2 倍放慢回到原速）。
   */
  console.log('\n[3] 自动循环（无定格 + 原速）');
  const obs = await observeFrameChanges(page, '.player-canvas', 4000);
  check(!obs.err, '能在页面内观测画面变化', obs.err || '');

  const changes = obs.changes || [];
  const uniq = new Set(changes.map((c) => c.hash)).size;

  check(changes.length >= 8, '画面在自动推进', `4 秒内变化 ${changes.length} 次`);
  check(uniq >= 4, '画面内容确实不同', `${uniq} 种不同画面`);

  const gaps = changes.slice(1).map((c, i) => c.t - changes[i].t);

  /**
   * 最长静止：rAF 与渲染同频（约 16.7ms 一次），所以一个 100ms 的帧
   * 会被观测到约 6 次才切换。原速 + 剔除定格后，最长静止应当就在
   * 100ms 上下。若定格帧漏网，1000ms 的定格会让间隔直接跳到 1000ms。
   *
   * 阈值 500ms：容得下几次重绘抖动，但拦得住漏网的定格。
   */
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;
  check(
    maxGap <= 500,
    '画面没有被定格卡住（定格帧已全部剔除）',
    `最长一次静止 ${maxGap}ms`,
  );

  /**
   * 量帧间隔中位数。素材的运动帧是 100ms，原速下期望 ≈100ms。
   *
   * 取**中位数**而不是平均值：开头第一帧可能因为解码 / 首绘而偏长，
   * 偶尔还会有 GC 抖动出一个离群值，平均值会被拉偏。
   * 中位数反映的是「常态节奏」，正是我们想测的东西。
   */
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;

  /**
   * 区间取 [70, 160]：
   *   下限 70ms  —— 排除掉帧 / 渲染跟不上（那会明显快于源帧时长）
   *   上限 160ms —— 排除「又放慢了」（2 倍放慢会到 ~200ms）
   * 干净值是 100ms 出头，两侧都有 30ms 以上余量。
   *
   * ⚠️ 改 SLOWDOWN 必须同步改这个区间，否则断言会以「速度不对」的名义
   * 拦住一次有意的调整 —— 这正是它的作用：逼人确认改动是有意的。
   */
  check(
    medianGap >= 70 && medianGap <= 160,
    '播放节奏是原速（帧间隔 ≈100ms）',
    `实测帧间隔中位数 ${medianGap}ms（${gaps.length} 次切换）`,
  );

  // 循环性：跑得够久的话，画面应当回到起点（这是「循环」而非「播完停住」）
  const loopHashes = changes.map((c) => c.hash);
  const backToStart = loopHashes.slice(-6).includes(loopHashes[0]);
  check(
    backToStart || uniq >= 5,
    '动画在循环播放（不是播完就停）',
    `尾段是否回到首帧: ${backToStart}`,
  );

  // ---------- 5. 呼吸 / 常见错误两块内容 ----------
  console.log('\n[4] 动作提示内容');
  const blocks = await page.locator('.guide-block-head').allTextContents();
  check(
    blocks.some((t) => t.includes('呼吸')),
    '显示呼吸节奏',
    blocks.find((t) => t.includes('呼吸')) || '',
  );
  check(
    blocks.some((t) => t.includes('常见错误')),
    '显示常见错误',
    blocks.find((t) => t.includes('常见错误')) || '',
  );
  const mistakeCount = await page.locator('.guide-mistakes > li').count();
  check(mistakeCount >= 2, '常见错误有多条内容', `${mistakeCount} 条`);
  const disclaimer = await page.locator('.guide-note').count();
  check(disclaimer > 0, '保留了免责说明');

  // ---------- 7. 浮层范围（本次改造最容易踩的坑） ----------
  /**
   * `.demo-overlay` 是绝对定位的角标层，高度被限制成 var(--player-stage-h)。
   *
   * 改造前它压根不该盖到控制条上；现在控制条没了，剩下唯一可交互的
   * 就是步骤列表 —— 而步骤列表在 stage **下面**。浮层一旦写回 top:0/bottom:0，
   * 就会盖住整个 .demo，把步骤按钮全部变成点不动的死区。
   *
   * 所以这里不再测「按钮能否被点到」，而是测「浮层底边没有越过 stage 底边」，
   * 并实测第一个步骤按钮的命中元素仍是它自己。
   */
  console.log('\n[6] 浮层只覆盖画面区');
  const overlayGeom = await page.evaluate(() => {
    const overlay = document.querySelector('.demo .demo-overlay');
    const stage = document.querySelector('.player-stage');
    const steps = document.querySelector('.player-steps');
    if (!overlay || !stage) return { err: 'missing' };
    const o = overlay.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const p = steps ? steps.getBoundingClientRect() : null;
    return {
      overlayBottom: Math.round(o.bottom),
      stageBottom: Math.round(s.bottom),
      // 浮层与步骤列表是否重叠（正常应为 0）
      overlapSteps: p ? Math.max(0, Math.round(Math.min(o.bottom, p.bottom) - Math.max(o.top, p.top))) : 0,
      overlayHeight: Math.round(o.height),
      stageHeight: Math.round(s.height),
    };
  });
  check(
    overlayGeom.err !== 'missing' && overlayGeom.overlayHeight <= overlayGeom.stageHeight + 2,
    '浮层高度不超过画面区',
    overlayGeom.err === 'missing'
      ? '找不到元素'
      : `浮层 ${overlayGeom.overlayHeight}px / 画面 ${overlayGeom.stageHeight}px`,
  );
  // 浮层不该盖住步骤列表 —— 步骤虽然不可点了，但被盖住就没法读，
  // 而它是演示区里唯一的文字说明。
  check(overlayGeom.overlapSteps === 0, '浮层没有压住步骤列表', `重叠 ${overlayGeom.overlapSteps}px`);

  // 截图统一输出到 player-shots/（已 gitignore），不要丢在仓库根目录
  fs.mkdirSync('player-shots', { recursive: true });
  await page.screenshot({ path: 'player-shots/detail.png' });
  console.log('  📸 player-shots/detail.png');

  // ---------- 8. 训练页播放器 ----------
  console.log('\n[7] 训练页播放器');
  /**
   * 训练页的播放器只在「有进行中的 session」时才渲染。
   * 走 UI 造这个状态要点进编排页、选动作、点开始训练，步骤多且依赖编排页的交互，
   * 一旦编排页改版这里就断 —— 而本脚本要测的是播放器，不是编排流程。
   * 所以直接往 localStorage 写一份 session，把前置条件准备掉。
   *
   * session 的 exercise 字段存的是**完整 Exercise 对象**，不是 slug。
   * catalog.json 被 Vite 打进 bundle 了（public/ 下没有），页面上 fetch 不到，
   * 所以从本地文件读 —— 脚本和资源都在同一个仓库里，路径是稳定的。
   * 硬编码一份假数据也行，但会和 catalog 结构脱钩，改了字段这里就静默失效。
   */
  const catalogPath = path.join(__dirname, 'src/lib/catalog.json');
  let sample = null;
  try {
    const list = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (Array.isArray(list) && list.length > 0) sample = list[0];
  } catch (e) {
    console.log(`  ⚠️ 读取 catalog.json 失败: ${e.message}`);
  }

  check(sample !== null, '能取到目录里的样例动作（训练页测试的前置数据）');

  if (sample) {
    await page.evaluate((ex) => {
      const session = {
        id: 'e2e-player',
        name: '播放器验证',
        startedAt: Date.now(),
        exercises: [
          {
            slug: ex.slug,
            exercise: ex,
            sets: [{ id: 's1', setNumber: 1, reps: 10, completed: false }],
          },
        ],
      };
      localStorage.setItem('strong-trainer-active-session', JSON.stringify(session));
    }, sample);

    // 重新加载让 App 读到刚写入的 session
    await page.goto(`${BASE}/#timer`);
    await page.reload({ waitUntil: isRemote ? 'load' : 'networkidle' });
    await page.waitForTimeout(isRemote ? 2500 : 900);

    const guidedPlayer = await page.locator('.guided-player').count();
    check(guidedPlayer > 0, '训练页出现播放器');

    if (guidedPlayer > 0) {
      await page
        .waitForFunction(() => !document.querySelector('.guided-player .player-loading'), {
          timeout: 15000,
        })
        .catch(() => {});
      const fpTrain = await canvasFingerprint(page, '.guided-player .player-canvas');
      check(fpTrain && fpTrain.opaque > 0, '训练页画面已解码');

      // 训练页同样是零交互的
      const trainInteractive = await page.evaluate(() => {
        const root = document.querySelector('.guided-player .player');
        if (!root) return -1;
        return root.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [tabindex]',
        ).length;
      });
      check(trainInteractive === 0, '训练页同样零交互', `可点元素 ${trainInteractive} 个`);

      // 训练页也在自动循环，且同样原速（同用页面内观测，避免协议开销污染）
      const trainObs = await observeFrameChanges(page, '.guided-player .player-canvas', 3000);
      const trainChanges = trainObs.changes || [];
      const trainUniq = new Set(trainChanges.map((c) => c.hash)).size;
      check(trainUniq >= 3, '训练页画面也在自动循环', `${trainUniq} 种画面`);

      const trainGaps = trainChanges.slice(1).map((c, i) => c.t - trainChanges[i].t);
      trainGaps.sort((a, b) => a - b);
      const trainMedian =
        trainGaps.length > 0 ? trainGaps[Math.floor(trainGaps.length / 2)] : 0;
      check(
        trainMedian >= 70 && trainMedian <= 160,
        '训练页同样保持原速',
        `帧间隔中位数 ${trainMedian}ms`,
      );

      // 训练页不显示步骤列表（传的是空数组，避免训练中信息过载）
      const trainSteps = await page.locator('.guided-player .player-step').count();
      check(trainSteps === 0, '训练页不显示步骤列表（避免信息过载）');

      await page.screenshot({ path: 'player-shots/timer.png' });
      console.log('  📸 player-shots/timer.png');
    }

    // 清掉造的数据，别污染下次跑
    await page.evaluate(() => localStorage.removeItem('strong-trainer-active-session'));
  }

  // ---------- 9. 控制台无报错 ----------
  console.log('\n[8] 控制台');
  // 忽略资源 404（缩略图可能缺失）和 React DevTools 提示
  const real = errors.filter(
    (e) => !/favicon|DevTools|404|Failed to load resource/i.test(e),
  );
  check(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '));

  await browser.close();

  console.log(`\n${'='.repeat(46)}`);
  console.log(`通过 ${pass}  失败 ${fail}`);
  console.log('='.repeat(46));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('\n脚本异常:', e.message);
  process.exit(1);
});
