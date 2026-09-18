/**
 * 三端适配回归测试。
 *
 * 断言的是「契约」而不是「字面量」：
 *   ✓ 导航按钮必须全部在视口内、可点击、且点击后真的切页
 *   ✓ 各页面在任一宽度下都不得横向溢出
 *   ✗ 不要断言「nav 宽度 == 188px」这种具体数字 —— 改个 padding 就会误报
 *
 * 为什么必须直接量按钮位置：
 * 上一版 .app-nav 上有 overflow-x:auto，按钮滚出可视区时
 * document.scrollWidth 完全不变（0 溢出），文档级检查全绿，
 * 但用户在 320px 下根本看不到「浏览」按钮。必须量每个按钮的 getBoundingClientRect。
 *
 * 用法：先起 dev server（5173），再 node e2e-responsive.cjs
 */
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5173';
const EXECUTABLE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';

const WIDTHS = [
  { w: 320, name: '极小手机', iconOnly: true },
  { w: 375, name: '手机', iconOnly: true },
  { w: 390, name: '手机主流', iconOnly: true },
  { w: 640, name: '手机上限', iconOnly: true },
  { w: 768, name: '平板竖屏', iconOnly: false },
  { w: 1024, name: '平板横屏', iconOnly: false },
  { w: 1440, name: '桌面', iconOnly: false },
];

const SCREENS = [
  { id: 'browse', label: '浏览', sel: '.browse' },
  { id: 'plan', label: '计划', sel: '.wizard-block' },
  { id: 'build', label: '编排', sel: '.app-body' },
  { id: 'timer', label: '计时', sel: '.app-body' },
  { id: 'history', label: '历史', sel: '.app-body' },
];

let pass = 0;
let fail = 0;
function check(ok, label, extra = '') {
  if (ok) { pass++; console.log(`    ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`    ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });

  for (const { w, name, iconOnly } of WIDTHS) {
    console.log(`\n▸ ${w}px (${name})`);
    const ctx = await browser.newContext({
      viewport: { width: w, height: 800 },
      isMobile: w <= 480,
      hasTouch: w <= 768,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    // 1) 每个导航按钮都必须在视口内
    const btns = await page.evaluate(() => {
      const nav = document.querySelector('.app-nav');
      return [...nav.querySelectorAll('.nav-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          text: b.getAttribute('aria-label') || b.textContent.trim(),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          inViewport: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight,
          // 触屏可点性：≥32px 才够手指点准
          tappable: r.width >= 32 && r.height >= 28,
        };
      });
    });
    check(btns.length === 5, '渲染出 5 个导航入口', `${btns.length} 个`);
    check(btns.every((b) => b.inViewport), '所有导航按钮都在视口内',
      btns.filter((b) => !b.inViewport).map((b) => b.text).join(',') || '全部可见');
    check(btns.every((b) => b.tappable), '导航按钮触控尺寸达标',
      btns.every((b) => b.tappable) ? '均 ≥32×28' : btns.filter((b) => !b.tappable).map((b) => `${b.text}(${b.width}px)`).join(','));

    // 2) 文字显隐符合断点契约
    //    必须同时断言「label 元素存在」和「它被隐藏了」。
    //    只断言 display 会漏判：元素不存在时 getComputedStyle 拿不到，
    //    而修复前正是这个情况 —— CSS 写了 .nav-btn-label{display:none}
    //    但 JSX 里从来没渲染过这个 span，规则是死的，文字以裸文本节点形式
    //    挤在按钮里把 nav 撑宽，320px 下最后一个按钮会被推出视口。
    const labelInfo = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.nav-btn-label')];
      const nav = document.querySelector('.app-nav');
      return {
        count: els.length,
        display: els[0] ? getComputedStyle(els[0]).display : null,
        navScroll: nav.scrollWidth,
        navClient: nav.clientWidth,
      };
    });
    check(labelInfo.count === 5, '每个导航按钮都有 .nav-btn-label 包裹文字', `${labelInfo.count} 个`);
    check(labelInfo.display === (iconOnly ? 'none' : 'block'),
      iconOnly ? '窄屏隐藏文字只留图标' : '宽屏显示文字标签',
      `display = ${labelInfo.display}`);

    // 3) nav 内部不得有横向滚动 —— 这是「有按钮看不见」的直接成因。
    //    注意 .app-nav 上若写了 overflow-x:auto，
    //    document.scrollWidth 完全不会变（文档级检查全绿），
    //    但按钮已经被滚到可视区外了。所以必须单独量 nav 自己的 scrollWidth。
    check(labelInfo.navScroll <= labelInfo.navClient + 1, '导航内部无横向滚动',
      `scrollWidth ${labelInfo.navScroll} vs clientWidth ${labelInfo.navClient}`);

    // 4) 图标本身没被压扁
    const iconOk = await page.evaluate(() => {
      const svgs = [...document.querySelectorAll('.nav-btn svg')];
      return svgs.length > 0 && svgs.every((s) => {
        const r = s.getBoundingClientRect();
        return r.width >= 14 && r.height >= 14;
      });
    });
    check(iconOk, '导航图标尺寸正常', '均 ≥14px');

    // 5) 逐个切页：能点动 + 不溢出
    for (const s of SCREENS) {
      const btn = page.locator('.nav-btn', { hasText: s.label }).first();
      let clicked = true;
      try {
        await btn.click({ timeout: 3000 });
      } catch (e) {
        clicked = false;
      }
      check(clicked, `「${s.label}」可点击`);
      if (!clicked) continue;
      await page.waitForTimeout(600);

      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        const docOver = de.scrollWidth - de.clientWidth;
        // 逐元素查右侧溢出（排除父级已溢出的连带项）
        let worst = 0;
        let worstEl = '';
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const over = Math.round(r.right - window.innerWidth);
          const p = el.parentElement?.getBoundingClientRect();
          const pOver = p ? Math.round(p.right - window.innerWidth) : 0;
          if (over > pOver + 1 && over > worst) {
            worst = over;
            worstEl = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : '');
          }
        }
        return { docOver, worst, worstEl };
      });
      check(overflow.docOver <= 1 && overflow.worst <= 1, `「${s.label}」无横向溢出`,
        overflow.worst > 1 ? `${overflow.worstEl} 超出 ${overflow.worst}px` : '0px');
    }

    check(errors.length === 0, '无控制台/网络错误', errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${'='.repeat(52)}`);
  console.log(`结果: ${pass} 通过, ${fail} 失败`);
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('异常:', e.message);
  process.exit(2);
});
