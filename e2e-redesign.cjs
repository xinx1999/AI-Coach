// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(`${BASE}/#browse`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.exercise-card');
  await sleep(1500);

  // 连加 3 个动作，每次都等弹窗关掉再操作下一个
  for (let i = 0; i < 3; i++) {
    await page.locator('.exercise-card').nth(i).click();
    await page.waitForSelector('.detail-modal');
    await sleep(300);
    const btn = page.locator('.detail-modal .btn-primary');
    if (await btn.count()) {
      await btn.click();
    } else {
      console.log(`  第 ${i + 1} 个已在训练里，跳过`);
    }
    await page.waitForSelector('.detail-modal', { state: 'detached' });
    await sleep(250);
  }

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('strong-trainer-draft-workout') || '[]'),
  );
  console.log(`[add] localStorage 里存了 ${stored.length} 个动作`);
  const badge = await page.locator('.nav-badge').innerText().catch(() => '(无)');
  console.log(`[add] 导航徽标显示: ${badge}`);

  // 切到编排页（同文档 hash 导航，不重载）
  await page.click('.nav-btn:has-text("编排")');
  await sleep(900);
  await page.screenshot({ path: path.join(__dirname, 'shot-build.png') });
  const items = await page.locator('.workout-item').count();
  console.log(`[build] 编排页显示 ${items} 个动作`);
  const setRows = await page.locator('.set-row').count();
  console.log(`[build] 共 ${setRows} 个组输入行`);
  const inputVals = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.workout-item'))
      .slice(0, 2)
      .map((w) => ({
        name: w.querySelector('.workout-item-name')?.textContent?.trim(),
        meta: w.querySelector('.workout-item-meta')?.textContent?.trim(),
        sets: Array.from(w.querySelectorAll('.set-row')).map((r) =>
          Array.from(r.querySelectorAll('input')).map((i) => i.value || i.placeholder),
        ),
      })),
  );
  console.log('[build] 明细:', JSON.stringify(inputVals, null, 2));

  // 刷新后是否还在（持久化验证）
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(700);
  await page.click('.nav-btn:has-text("编排")');
  await sleep(700);
  const afterReload = await page.locator('.workout-item').count();
  console.log(`[build] 刷新后仍有 ${afterReload} 个动作`);

  // 开始训练 → 计时页
  await page.click('.btn-primary:has-text("开始训练")');
  await sleep(1200);
  await page.screenshot({ path: path.join(__dirname, 'shot-timer.png') });
  const guidedName = await page.locator('.guided-name, .section-row h2').first().innerText().catch(() => '?');
  const hasDemo = await page.locator('.guided-demo img').count();
  console.log(`[timer] 当前动作「${guidedName}」，动图元素 ${hasDemo} 个`);
  const demoOk = await page.evaluate(() => {
    const i = document.querySelector('.guided-demo img');
    return i ? { src: i.getAttribute('src'), w: i.naturalWidth } : null;
  });
  console.log('[timer] 动图:', JSON.stringify(demoOk));

  // 完成一组，看是否进入休息
  await page.click('.btn-primary:has-text("完成这组")');
  await sleep(1600);
  const phase = await page.locator('.guided-phase').innerText().catch(() => '?');
  const count = await page.locator('.guided-count').innerText().catch(() => '?');
  console.log(`[timer] 完成一组后 → 阶段「${phase}」，倒数 ${count}`);
  await page.screenshot({ path: path.join(__dirname, 'shot-timer-rest.png') });

  console.log('\n控制台错误:', errors.length === 0 ? '无 ✅' : JSON.stringify(errors, null, 2));
  await browser.close();
})();
