/**
 * 顶栏专项审计。
 *
 * 为什么单独测顶栏：.app-nav 有 overflow-x:auto，
 * 它内部滚走的内容不会体现为 document 级溢出，
 * 所以上一个脚本全绿——但用户看到的正是「导航被切掉一截」。
 * 必须直接量 nav 的 scrollWidth 与 clientWidth 的差。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXECUTABLE } = require('./e2e-setup.cjs');

const BASE = 'http://localhost:5173';

const WIDTHS = [320, 360, 375, 390, 414, 480, 600, 720, 768, 900, 1024, 1280, 1440];

const MEASURE = () => {
  const header = document.querySelector('.app-header');
  const title = document.querySelector('.app-title');
  const nav = document.querySelector('.app-nav');
  if (!header || !nav) return null;

  const hr = header.getBoundingClientRect();
  const tr = title ? title.getBoundingClientRect() : null;
  const nr = nav.getBoundingClientRect();

  const labels = [...nav.querySelectorAll('.nav-btn')].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      text: (b.textContent || '').trim().slice(0, 6),
      visible: r.width > 0,
      left: Math.round(r.left),
      right: Math.round(r.right),
      clippedLeft: Math.round(hr.left - r.left),
      clippedRight: Math.round(r.right - hr.right),
    };
  });

  return {
    vw: window.innerWidth,
    headerScroll: header.scrollWidth,
    headerClient: header.clientWidth,
    navScroll: nav.scrollWidth,
    navClient: nav.clientWidth,
    navOverflow: nav.scrollWidth - nav.clientWidth,
    titleRight: tr ? Math.round(tr.right) : null,
    navLeft: Math.round(nr.left),
    titleNavGap: tr ? Math.round(nr.left - tr.right) : null,
    labels,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  console.log('\n顶栏在各宽度下的表现\n');
  console.log('宽度   nav滚动/可视   溢出  标题右缘  导航左缘  间距  被裁按钮');
  console.log('-'.repeat(78));

  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: w <= 480 });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const m = await page.evaluate(MEASURE);
    if (!m) { console.log(`${w}  ✗ 找不到顶栏`); await ctx.close(); continue; }

    const clipped = m.labels.filter((l) => l.clippedLeft > 1 || l.clippedRight > 1);
    const hidden = m.labels.filter((l) => !l.visible);
    const flag = m.navOverflow > 1 || clipped.length ? '⚠' : ' ';

    console.log(
      `${String(w).padEnd(6)}${String(m.navScroll + '/' + m.navClient).padEnd(15)}` +
      `${String(m.navOverflow).padEnd(6)}${String(m.titleRight).padEnd(10)}` +
      `${String(m.navLeft).padEnd(10)}${String(m.titleNavGap).padEnd(6)}` +
      `${clipped.map((c) => c.text).join(',') || (hidden.length ? hidden.map((h) => h.text).join(',') + '(隐藏)' : '-')} ${flag}`
    );

    await ctx.close();
  }

  await browser.close();
  console.log('');
})();
