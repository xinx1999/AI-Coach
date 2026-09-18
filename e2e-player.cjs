/**
 * 动作演示播放器的端到端验证。
 *
 * ## 为什么必须用真实浏览器跑
 *
 * 播放器的核心是「把 GIF 解码成逐帧位图再画到 canvas」，这条链路里
 * 有三处只在浏览器里才成立、Node 里测不到的东西：
 *   1. canvas 的 getImageData / putImageData 行为
 *   2. omggif 解码出的 RGBA 是否真的画出了人形（解码器用错会得到全透明）
 *   3. 点击步骤后画面是否真的变了（React 重渲染 + canvas 重绘的时序）
 *
 * 所以这里不只断言「元素存在」，而是**读 canvas 的像素**来确认每一帧
 * 确实有不同的内容 —— 这是唯一能证明「解码 + 合成」正确的方式。
 *
 * ## 没有控制条了，怎么验「剔除定格帧」还在生效
 *
 * 界面刻意去掉了暂停 / 逐帧 / 慢放，用户唯一的操作是点步骤。
 * 于是「逐帧步进」这个测法失效了 —— 没有按钮可点。
 *
 * 但剔除定格帧恰恰是本项目流畅度的**唯一**来源（见 src/lib/gifFrames.ts），
 * 必须继续有断言守着。替代方案是**定时采样**：让它自己放，每隔一段时间
 * 取一次 canvas 像素指纹，检查画面是否在一路推进。
 *
 * 如果哪天有人把 motionFrameIndices 去掉、改回原始帧序列，
 * 采样就会撞上 500ms/1000ms 的定格 —— 相邻两次采样指纹相同 —— 断言报警。
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
 * 当前高亮的是第几条步骤。取**下标**而不是文案 —— 文案会随数据集变化，
 * 下标才是稳定的比较对象。返回 -1 表示没有任何一条高亮。
 */
async function activeStepIndex(page) {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.player-step'));
    return list.findIndex((el) => el.classList.contains('on'));
  });
}

/**
 * 定时采样 canvas 指纹，观察自动循环的动画是否真的在推进。
 *
 * `interval` 要**明显小于**定格帧时长（500ms/1000ms），否则一次定格
 * 最多只被采到一次，抓不住「卡住」这件事。取 160ms：一个 1000ms 的
 * 定格会被连采 6 次，指纹相同立刻暴露。
 *
 * `samples` 次采样覆盖约 160×N ms。取 14 ≈ 2.2s，对 4fps 的素材
 * 足够走完 4~8 个运动帧，同时把脚本耗时控制住。
 */
async function sampleFrames(page, selector, samples = 14, interval = 160) {
  const seen = [];
  for (let i = 0; i < samples; i += 1) {
    const fp = await canvasFingerprint(page, selector);
    if (fp) seen.push(fp.hash);
    await page.waitForTimeout(interval);
  }
  return seen;
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

  // ---------- 3. 自动循环：画面必须一路推进 ----------
  /**
   * 这是本次改造后最重要的断言。
   *
   * 控制条被去掉了，用户看到的就是一段自动播放的循环。它流畅与否
   * 完全取决于「定格帧是否被剔除」—— 所以断言必须直接盯着画面本身。
   *
   * 两个层次：
   *   a) 画面在动      —— 采样到多个不同的指纹
   *   b) 画面一直在动  —— 不允许出现长串完全静止的采样（那正是定格帧）
   */
  console.log('\n[2] 自动循环（剔除定格帧的效果）');
  const hasControls = await page.locator('.player-controls, .player-btn, .player-speed, .player-scrub').count();
  check(hasControls === 0, '界面已无控制条（暂停/逐帧/慢放/进度）', `残留 ${hasControls} 个`);

  const samples = await sampleFrames(page, '.player-canvas', 14, 160);
  const uniq = new Set(samples).size;

  check(samples.length >= 12, '完成定时采样', `${samples.length} 次`);
  check(uniq >= 4, '画面在自动推进', `${uniq} 种不同画面 / ${samples.length} 次采样`);

  /**
   * 最长静止段。
   *
   * 采样间隔 160ms，一个 1000ms 的定格帧会被连采 6~7 次；500ms 的定格
   * 会被连采 3~4 次。剔除干净的话，只会因为渲染时序偶尔重到一次
   * （React 状态提交 + canvas 重绘不在同一帧），不会成串。
   *
   * 阈值 3：允许 3 次连续相同（约 480ms，覆盖一次时序抖动 + 一个 100ms
   * 的运动帧），但抓到 4 次以上就说明有定格漏网了。
   */
  let maxStill = 1;
  let run = 1;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] === samples[i - 1]) {
      run += 1;
      maxStill = Math.max(maxStill, run);
    } else {
      run = 1;
    }
  }
  check(
    maxStill <= 3,
    '画面没有被定格卡住（定格帧已全部剔除）',
    `最长静止 ${maxStill} 次采样 ≈ ${(maxStill * 160) / 1000}s`,
  );

  // 循环性：跑得够久的话，画面应当回到起点（这是「循环」而非「播完停住」）
  const firstHash = samples[0];
  const backToStart = samples.slice(-6).includes(firstHash);
  check(backToStart || uniq >= 5, '动画在循环播放（不是播完就停）', `尾段是否回到首帧: ${backToStart}`);

  // ---------- 4. 步骤联动：点第 3 步画面应跳走 ----------
  console.log('\n[3] 步骤与画面联动');
  const stepBtns = page.locator('.player-step');
  const stepCount = await stepBtns.count();
  check(stepCount >= 4, '步骤列表已渲染', `${stepCount} 条`);

  if (stepCount >= 4) {
    /**
     * 点击步骤的正确断言：**点击生效**，而不是「高亮一直停在被点的那条」。
     *
     * 这里踩过一次坑。最初写成「点第 1 步读一次高亮，点最后一步再读一次，
     * 两者应当不同」，结果最后一步必然失败 —— 不是点击坏了，是动画还在跑：
     * 点末步会跳到运动序列的末帧，约 100ms 后循环回绕到 motion[0]，
     * 而 frame 0 本来就离第 1 步最近，高亮于是落回第 1 步。这是循环播放的
     * 正常行为，不是 bug。
     *
     * 所以断言要盯住「点下去的那一刻高亮是否落到该步」：点完立刻读，
     * 不做等待 —— 等待反而会让动画把结果改写。
     *
     * 顺带因此暴露了一个真 bug 并已修掉：原实现按「帧号不超过当前帧的最后一步」
     * 取高亮（向下取整），回绕时第 1 帧会让高亮从末步直接弹回第 1 步；
     * 改成取**距离最近**的步骤后，末步在整个回绕过程中都不再被错误抢占。
     */
    const clicked = [];
    for (const i of [0, 2, stepCount - 1]) {
      await stepBtns.nth(i).click();
      // 不等待：动画每 ~100ms 就会改写高亮，等一下就测不到「点击本身」了
      clicked.push(await activeStepIndex(page));
      await page.waitForTimeout(150);
    }
    check(
      clicked.every((got, k) => got === [0, 2, stepCount - 1][k]),
      '点击任意步骤，高亮立刻落到该步骤',
      `期望 1/${3}/${stepCount}，实际 ${clicked.map((x) => x + 1).join('/')}`,
    );

    // 画面必须跟着跳：点首步与点末步应当是不同的画面。
    // 不变说明 stepToFrame 没生效（高亮对了但画面没动）。
    await stepBtns.nth(0).click();
    await page.waitForTimeout(120);
    const fpA = await canvasFingerprint(page, '.player-canvas');
    await stepBtns.nth(stepCount - 1).click();
    await page.waitForTimeout(120);
    const fpB = await canvasFingerprint(page, '.player-canvas');
    check(
      fpA && fpB && fpA.hash !== fpB.hash,
      '点步骤后画面跳到了对应帧',
      fpA && fpB ? `${fpA.hash} → ${fpB.hash}` : '读不到像素',
    );
  }

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
  check(overlayGeom.overlapSteps === 0, '浮层没有压住步骤列表', `重叠 ${overlayGeom.overlapSteps}px`);

  // 实测：步骤按钮点击的命中元素必须还是它自己（或子节点）
  const stepHit = await page.evaluate(() => {
    const btn = document.querySelector('.player-step');
    if (!btn) return 'no-button';
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!el) return 'nothing';
    return btn.contains(el) ? 'ok' : `${el.tagName}.${el.className}`;
  });
  check(stepHit === 'ok', '步骤按钮可正常点击（未被浮层截走）', `命中: ${stepHit}`);

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

      // 训练页同样没有控制条，靠自动循环 —— 确认它也在动
      const trainControls = await page
        .locator('.guided-player .player-controls, .guided-player .player-btn, .guided-player .player-speed')
        .count();
      check(trainControls === 0, '训练页同样没有控制条', `残留 ${trainControls} 个`);

      const trainLoop = await sampleFrames(page, '.guided-player .player-canvas', 10, 160);
      check(
        new Set(trainLoop).size >= 3,
        '训练页画面也在自动循环',
        `${new Set(trainLoop).size} 种画面 / ${trainLoop.length} 次采样`,
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
