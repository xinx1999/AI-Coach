/**
 * 三端适配审计：在各断点宽度下打开每个页面，
 * 找出「横向溢出」和「元素被压得不可用」的地方。
 *
 * 为什么要量 overflow 而不是靠肉眼看截图：
 * 溢出常常只差几像素，截图缩放下看不出来；
 * 而 scrollWidth - clientWidth 是个确定的数字，有就是有。
 *
 * 断点参考（对应要适配的三端）：
 *   375  手机（iPhone SE/13 mini 这一档）
 *   390  手机主流（iPhone 13/14/15）
 *   768  平板竖屏（iPad）
 *   1024 平板横屏 / 小笔记本
 *   1440 桌面
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXECUTABLE } = require('./e2e-setup.cjs');

const BASE = 'http://localhost:5173';

const WIDTHS = [
  { w: 320, label: '320 极小手机' },
  { w: 375, label: '375 手机' },
  { w: 390, label: '390 手机主流' },
  { w: 768, label: '768 平板竖屏' },
  { w: 1024, label: '1024 平板横屏' },
  { w: 1440, label: '1440 桌面' },
];

const SCREENS = [
  { id: 'plan', label: '计划', navText: '计划' },
  { id: 'browse', label: '浏览', navText: '浏览' },
  { id: 'build', label: '编排', navText: '编排' },
  { id: 'timer', label: '计时', navText: '计时' },
  { id: 'history', label: '历史', navText: '历史' },
];

// 在页面里测量所有横向溢出的元素
const MEASURE = () => {
  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const offenders = [];

  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };

  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // 相对视口右侧溢出
    const over = Math.round(r.right - window.innerWidth);
    if (over > 1) {
      // 只在「父级没有同样溢出」时记录，避免一个容器溢出导致所有子元素都被列出来
      const p = el.parentElement;
      const pr = p ? p.getBoundingClientRect() : null;
      const parentOver = pr ? Math.round(pr.right - window.innerWidth) : 0;
      if (over > parentOver + 1) {
        offenders.push({ el: describe(el), over, width: Math.round(r.width) });
      }
    }
  }

  // 元素被压得过窄（文字会挤成一列或截断）
  const cramped = [];
  for (const el of document.querySelectorAll('.nav-btn, .wizard-seg-btn, .loc-tab, .muscle-chip, button')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.width < 24) {
      cramped.push({ el: describe(el), width: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 12) });
    }
  }

  return { docOverflow, offenders: offenders.slice(0, 12), cramped: cramped.slice(0, 8) };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  let problems = 0;

  for (const { w, label } of WIDTHS) {
    console.log(`\n${'='.repeat(58)}`);
    console.log(`视口 ${label}`);
    console.log('='.repeat(58));

    const ctx = await browser.newContext({
      viewport: { width: w, height: 800 },
      deviceScaleFactor: 1,
      isMobile: w <= 390,
      hasTouch: w <= 768,
    });
    const page = await ctx.newPage();

    for (const s of SCREENS) {
      // 用点击切页，不用 goto('#hash')：后者是同文档导航，不会重渲染
      if (s.id !== 'plan') {
        const btn = page.locator('.nav-btn', { hasText: s.navText }).first();
        if (await btn.count()) {
          await btn.click().catch(() => {});
        }
      }
      await page.waitForTimeout(700);

      const m = await page.evaluate(MEASURE);
      const bad = m.docOverflow > 1;
      const tag = bad || m.offenders.length || m.cramped.length ? '⚠' : '✓';
      if (bad || m.offenders.length || m.cramped.length) problems++;

      console.log(`  ${tag} ${s.label.padEnd(4)}  文档横向溢出 ${m.docOverflow}px`);
      if (m.offenders.length) {
        console.log(`      溢出元素:`);
        m.offenders.forEach((o) => console.log(`        ${o.el}  右侧超出 ${o.over}px  宽 ${o.width}px`));
      }
      if (m.cramped.length) {
        console.log(`      被压过窄:`);
        m.cramped.forEach((c) => console.log(`        ${c.el}  宽仅 ${c.width}px  「${c.text}」`));
      }
    }

    await ctx.close();
  }

  await browser.close();
  console.log(`\n${'='.repeat(58)}`);
  console.log(`合计问题数: ${problems}`);
  console.log('='.repeat(58));
})();
