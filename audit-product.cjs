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
  // 清空存储后再进首页，测「一个全新用户」会落到哪里。
  // 注意：落点不再是固定的浏览页，而是按处境决定（见 App.tsx getInitialScreen），
  // 空手时应落到计划页。这里的断言随产品意图一起更新，不是放宽标准。
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  log('A1 空手首次进入 hash', await page.evaluate(() => location.hash || '(空)'));

  // 显式进浏览页再测动作总数（深链优先级由 e2e-landing 覆盖）
  await page.goto(BASE + '/#browse', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  log('A1 浏览页标题', await page.locator('.page-title').first().innerText());
  log('A1 动作总数', await page.locator('.page-count').first().innerText());

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
  // 快速添加的第一个动作来自完整目录（按部位排序），本项目不假定它的计量方式，
  // 只如实记录渲染出的输入形态；计量方式本身的正确性由 e2e-optimize 的 [D] 段覆盖。
  await page.locator('.pill:has-text("+")').first().click();
  await page.waitForTimeout(300);
  log('C0 快速添加后动作数', await page.locator('.workout-item').count());
  const setRow = page.locator('.workout-item .set-row').first();
  const labels = await setRow.locator('.set-input-label').allInnerTexts();
  log('C1 每组输入框数量', await setRow.locator('input').count());
  log('C1 输入单位标签', JSON.stringify(labels));

  // C2: 首个动作的归属信息，用于确认中文标签已接入
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

  // ---------- K. 演示媒体的加载表现与主题对比度 ----------
  // 素材已从「三张自绘 SVG」换成数据集提供的 180×180 循环 GIF，
  // 因此这里改为审计 GIF 是否真的加载成功、以及浅色主题下的对比度。
  const demoAudit = await page.evaluate(async () => {
    const r = await fetch('/media/gif/1275-Q497lAE.gif');
    const blob = await r.blob();
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // GIF89a 的动画扩展块标志：0x21 0xF9 之后紧跟的 control block
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46; // "GIF"
    // 粗略数一下图形控制块个数，>1 说明是多帧（会动）
    let frames = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    }
    return { ok: r.ok, status: r.status, isGif, frames, size: blob.size };
  });
  log('K1 演示 GIF 可达性', JSON.stringify(demoAudit));
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
  /**
   * 这里必须校验 content-type 和内容形状，不能只看 fetch 是否 ok。
   *
   * 曾经踩过的坑：dev/preview 服务器对未知路径会回落到 index.html（SPA 兜底），
   * 于是 fetch('/manifest.json') 拿到 200 + 一整页 HTML，`ok` 为 true，
   * 就被记成「有 manifest」——一个彻头彻尾的假阳性，把 PWA 能力的缺失盖了过去。
   * 所以现在要求：content-type 是 JSON，且解析出来带 name/icons 这类 manifest 字段。
   */
  const manifest = await page.evaluate(async () => {
    try {
      const res = await fetch('/manifest.json');
      const type = res.headers.get('content-type') || '';
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* 不是 JSON 就不是 manifest */ }
      return {
        ok: res.ok,
        type,
        isJson: type.includes('json') && json !== null,
        hasName: !!(json && (json.name || json.short_name)),
        hasIcons: !!(json && Array.isArray(json.icons) && json.icons.length > 0),
        looksLikeHtml: text.trimStart().startsWith('<!doctype') || text.trimStart().startsWith('<html'),
      };
    } catch {
      return { ok: false, type: '', isJson: false, hasName: false, hasIcons: false, looksLikeHtml: false };
    }
  });
  log('M1 manifest 请求', `ok=${manifest.ok} type=${manifest.type || '(无)'}`);
  log('M1 是否真的是 manifest', manifest.isJson && manifest.hasName && manifest.hasIcons);
  if (manifest.looksLikeHtml) log('M1 注意', '拿到的是 HTML —— SPA 兜底造成的假阳性，不等于存在 manifest');
  log('M1 浏览器是否支持 service worker', await page.evaluate(() => 'serviceWorker' in navigator));
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
