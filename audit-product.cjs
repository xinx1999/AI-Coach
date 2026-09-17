/**
 * 产品视角审计脚本：验证几处「从代码读出来但需要运行时确认」的结论。
 * 只读、不改数据，用于给评审报告提供证据。
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:4199';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  const out = [];
  const log = (k, v) => out.push(`${k} :: ${v}`);

  // ---------- A. 首次进入落点 ----------
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  log('A1 首次进入 hash', await page.evaluate(() => location.hash || '(空)'));
  log('A1 首次进入页面标题', await page.locator('.section-row h2').first().innerText());

  // 清空后重新进入编排页
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/#build', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // ---------- B. 编排页基础形态 ----------
  // 用 .app-body 内的「今日训练」标题确认真的在编排页（hash 路由首帧可能还没切）
  await page.waitForSelector('h2:text("今日训练")', { timeout: 15000 });
  log('B1 编排初始动作数', await page.locator('.workout-item').count());

  // ---------- C. 走真实交互添加动作，观察每组的输入 UI ----------
  await page.locator('.pill:has-text("+")').first().click();
  await page.waitForTimeout(300);
  log('C0 快速添加后动作数', await page.locator('.workout-item').count());
  const setRow = page.locator('.workout-item .set-row').first();
  log('C1 距离类动作的输入框数量', await setRow.locator('input').count());
  const labels = await setRow.locator('.set-input-label').allInnerTexts();
  log('C1 输入单位标签', JSON.stringify(labels));

  // C2: 距离类动作的真实类型（用 catalog 里的 running 反查页面显示）
  const firstCardMeta = await page.locator('.workout-item-meta').first().innerText();
  log('C2 第一个动作的元信息', firstCardMeta.replace(/\n/g, ' '));

  // ---------- D. 编排页改重量，是否被计时页采纳 ----------
  // ---------- D. 编排页改次数，是否被计时页采纳 ----------
  const repsInput = setRow.locator('input').first();
  await repsInput.fill('8');
  await page.waitForTimeout(200);
  await page.locator('button:has-text("开始训练")').click();
  await page.waitForSelector('.guided-card', { timeout: 15000 });
  await page.waitForTimeout(300);
  const guidedTarget = await page.locator('.guided-target').innerText();
  log('D1 编排填 8 次后，计时页显示', guidedTarget.replace(/\n/g, ' '));

  // ---------- E. 计时页改重量有没有入口 ----------
  log('E1 计时页卡片内可编辑输入框数', await page.locator('.guided-card input').count());

  // ---------- F. 休息时长是否跨会话记忆 ----------
  await page.locator('.rest-preset-row .preset-btn', { hasText: '30s' }).click();
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const activeRest = await page.locator('.rest-preset-row .preset-btn.active').innerText();
  log('F1 选 30s 后刷新，休息预设回到', activeRest);

  // ---------- G. 存储被清空后能否回到可用状态 ----------
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  log('G1 清空存储后计时页文本', (await page.locator('.app-body').innerText()).slice(0, 120).replace(/\n/g, ' | '));

  // ---------- H. 历史页的近 8 周统计口径 ----------
  await page.evaluate(() => {
    const now = Date.now();
    const mk = (daysAgo, name) => ({
      name, notes: '', startedAt: new Date(now - daysAgo * 86400000).toISOString(),
      completedAt: new Date(now - daysAgo * 86400000 + 3600000).toISOString(), exercises: [],
    });
    // 造 4 次：今天、昨天、7 天前（跨周）、40 天前（同一周桶外的）
    localStorage.setItem('strong-trainer-data', JSON.stringify({
      favorites: [],
      sessions: [mk(0, '今天'), mk(1, '昨天'), mk(7, '7天前'), mk(13, '13天前'), mk(40, '40天前')],
    }));
  });
  await page.goto(BASE + '/#history', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const bars = await page.locator('.stats-col').evaluateAll((els) =>
    els.map((e) => e.getAttribute('title')),
  );
  log('H1 周桶标题', JSON.stringify(bars));
  const heights = await page.locator('.stats-bar').evaluateAll((els) =>
    els.map((e) => e.style.height),
  );
  log('H1 柱高', JSON.stringify(heights));

  // ---------- I. 历史记录按时间倒序？还是在最前？ ----------
  const names = await page.locator('.history-name').allInnerTexts();
  log('I1 历史列表顺序', JSON.stringify(names));

  // ---------- J. 键盘可达性：能否只靠 Tab 完成一次勾组 ----------
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/#browse', { waitUntil: 'networkidle' });
  const tabbables = await page.evaluate(() => {
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return document.querySelectorAll(sel).length;
  });
  log('J1 浏览页可 Tab 元素数', tabbables);

  // ---------- K. 素材 SVG 的填充色与容器对比度 ----------
  const svgFill = await page.evaluate(async () => {
    const r = await fetch('/assets/bench-press/frame-1.svg');
    const t = await r.text();
    const m = t.match(/fill="(#[0-9a-fA-F]{3,6})"/g) || [];
    const counts = {};
    m.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  });
  log('K1 frame-1.svg 的 fill 取值 TOP3', JSON.stringify(svgFill));
  const rootBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rootText = await page.evaluate(() => getComputedStyle(document.body).color);
  log('K2 主题背景/文字', `${rootBg} / ${rootText}`);
  const prefersDark = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  log('K3 headless 环境 prefers-color-scheme: dark', prefersDark);

  // ---------- L. 详情弹窗的焦点管理 ----------
  await page.goto(BASE + '/#browse', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.exercise-card', { timeout: 15000 });
  await page.locator('.exercise-card').first().click();
  await page.waitForTimeout(400);
  log('L1 弹窗打开后焦点元素', await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName));
  log('L2 弹窗是否有 role=dialog / aria-modal',
    await page.evaluate(() => {
      const d = document.querySelector('.detail-modal');
      return d ? `${d.getAttribute('role')} / ${d.getAttribute('aria-modal')}` : '(无弹窗)';
    }));
  // 弹窗内可否 Tab 到按钮（焦点陷阱是否存在）
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  log('L3 弹窗内 Tab 一次后焦点', await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  log('L4 Esc 可关闭', !(await page.locator('.detail-modal').isVisible().catch(() => false)));

  // ---------- M. 分享/离线能力 ----------
  log('M1 是否有 manifest.json', await page.evaluate(async () => (await fetch('/manifest.json').catch(() => ({ ok: false }))).ok));
  log('M1 是否有 service worker', await page.evaluate(() => 'serviceWorker' in navigator));
  const swCount = await page.evaluate(() => navigator.serviceWorker?.getRegistrations?.().then((r) => r.length) ?? 0);
  log('M1 已注册 SW 数量', swCount);

  // ---------- N. 一次会话里能否把同一动作放进两次不同重量 ----------
  log('N1 导航项', JSON.stringify(await page.locator('.nav-btn').allInnerTexts()));

  console.log('\n===== 审计结果 =====');
  out.forEach((l) => console.log(l));
  console.log('\n===== 控制台错误 =====');
  console.log(errors.length ? errors.join('\n') : '(无)');

  await browser.close();
})();
