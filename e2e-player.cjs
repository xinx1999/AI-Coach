/**
 * 动作分解播放器的端到端验证。
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

  // ---------- 3. 逐帧步进：每帧画面必须不同 ----------
  console.log('\n[2] 逐帧步进');
  const nextBtn = page.locator('.player-btn[title="下一帧"]');
  const hasNext = (await nextBtn.count()) > 0;
  check(hasNext, '存在「下一帧」按钮');

  if (hasNext) {
    const hashes = [];
    const fpStart = await canvasFingerprint(page, '.player-canvas');
    if (fpStart) hashes.push(fpStart.hash);

    let steps = 0;
    for (let i = 0; i < 8; i += 1) {
      const disabled = await nextBtn.isDisabled();
      if (disabled) break;
      await nextBtn.click();
      await page.waitForTimeout(120);
      const fp = await canvasFingerprint(page, '.player-canvas');
      if (fp) hashes.push(fp.hash);
      steps += 1;
    }

    // 走 8 次至少应看到 5 种不同画面。
    // 数字能证明「帧真的在变」，而不是每帧画了同一张图。
    const uniq = new Set(hashes).size;
    check(steps >= 6, '可连续步进多帧', `实际步进 ${steps} 次`);
    check(uniq >= 5, '各帧画面内容确实不同', `指纹数 ${uniq}`);

    /**
     * 最关键的一条：不允许出现「画面没变」的相邻步进。
     *
     * 数据集每个循环里夹着 1～3 处长定格（1000ms / 500ms），
     * 早期的实现直接对帧号 ±1，于是「下一帧」有相当大概率停在一张
     * 和上一帧几乎相同的画面上 —— 用户会以为按钮点不动。
     * 现在步进走的是「运动帧序列」，每按一次都必须看到新画面。
     *
     * 允许一次重复（同一帧可能因渲染时序读到缓存），但不能连续两次。
     */
    let adjacentSame = 0;
    let worstRun = 0;
    for (let i = 1; i < hashes.length; i += 1) {
      if (hashes[i] === hashes[i - 1]) {
        adjacentSame += 1;
        worstRun = Math.max(worstRun, 2);
      }
    }
    check(
      adjacentSame <= 1,
      '步进时画面每次都变（定格帧已被跳过）',
      `相邻重复 ${adjacentSame} 次 / 共 ${steps} 步`,
    );
  }

  // ---------- 4. 慢放档位 ----------
  console.log('\n[3] 慢放控制');
  const speedBtns = page.locator('.player-speed');
  const speedCount = await speedBtns.count();
  check(speedCount === 3, '提供 3 档速度', `实际 ${speedCount} 档`);

  if (speedCount === 3) {
    await speedBtns.nth(0).click();
    await page.waitForTimeout(80);
    const onAfter = await page.locator('.player-speed.on').textContent();
    check(onAfter?.includes('0.25'), '点击后 0.25x 变为选中态', `选中: ${onAfter}`);
  }

  // ---------- 5. 步骤联动：点第 3 步画面应跳走 ----------
  console.log('\n[4] 步骤与画面联动');
  const stepBtns = page.locator('.player-step');
  const stepCount = await stepBtns.count();
  check(stepCount >= 4, '步骤列表已渲染', `${stepCount} 条`);

  if (stepCount >= 4) {
    // 先回到第 1 步，再跳到第 3 步，比较两帧是否不同
    await stepBtns.nth(0).click();
    await page.waitForTimeout(150);
    const fpA = await canvasFingerprint(page, '.player-canvas');
    const activeA = await page.locator('.player-step.on').textContent();

    const last = stepCount - 1;
    await stepBtns.nth(last).click();
    await page.waitForTimeout(150);
    const fpB = await canvasFingerprint(page, '.player-canvas');
    const activeB = await page.locator('.player-step.on').textContent();

    check(activeA !== activeB, '点击不同步骤时高亮跟随切换');
    // 首步和末步必然指向不同帧，画面必须变。不变说明 stepToFrame 没生效。
    check(
      fpA && fpB && fpA.hash !== fpB.hash,
      '点步骤后画面跳到了对应帧',
      fpA && fpB ? `${fpA.hash} → ${fpB.hash}` : '读不到像素',
    );
  }

  // ---------- 6. 呼吸 / 常见错误两块内容 ----------
  console.log('\n[5] 动作提示内容');
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

  // ---------- 7. 浮层不遮挡控制条（本次改造最容易踩的坑） ----------
  console.log('\n[6] 浮层不遮挡控制条');
  const overlayHit = await page.evaluate(() => {
    const btn = document.querySelector('.player-btn-main');
    if (!btn) return 'no-button';
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // 命中的元素应当是按钮本身或它的子节点（svg）
    if (!el) return 'nothing';
    return btn.contains(el) ? 'ok' : `${el.className}`;
  });
  check(overlayHit === 'ok', '播放按钮未被浮层截走点击', `命中: ${overlayHit}`);

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
