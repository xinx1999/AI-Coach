/**
 * 诊断：为什么手机上点导航切不过去？
 * 怀疑是 .app-nav 的 overflow-x:auto 让按钮滚出可视区，
 * 点击坐标落在视口外 → Playwright 报「元素不可点击」。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXECUTABLE } = require('./e2e-setup.cjs');

const BASE = 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });

  for (const w of [320, 375, 390]) {
    console.log(`\n--- 视口 ${w}px ---`);
    const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const info = await page.evaluate(() => {
      const nav = document.querySelector('.app-nav');
      const nr = nav.getBoundingClientRect();
      return {
        navRect: { left: Math.round(nr.left), right: Math.round(nr.right), width: Math.round(nr.width) },
        navScrollW: nav.scrollWidth,
        navClientW: nav.clientWidth,
        buttons: [...nav.querySelectorAll('.nav-btn')].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            text: b.textContent.trim().slice(0, 4),
            left: Math.round(r.left),
            right: Math.round(r.right),
            w: Math.round(r.width),
            inViewport: r.left >= 0 && r.right <= window.innerWidth,
          };
        }),
      };
    });

    console.log(`  nav rect: left=${info.navRect.left} right=${info.navRect.right} width=${info.navRect.width}`);
    console.log(`  nav scrollWidth=${info.navScrollW} clientWidth=${info.navClientW} 差=${info.navScrollW - info.navClientW}`);
    info.buttons.forEach((b) => {
      console.log(`    ${b.text.padEnd(4)} left=${String(b.left).padEnd(6)} right=${String(b.right).padEnd(6)} w=${String(b.w).padEnd(5)} ${b.inViewport ? '' : '← 视口外'}`);
    });

    // 试试点「浏览」
    const btn = page.locator('.nav-btn', { hasText: '浏览' }).first();
    try {
      const box = await btn.boundingBox();
      console.log(`  浏览按钮 boundingBox: ${box ? JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) }) : 'null（不可见）'}`);
      await btn.click({ timeout: 4000 });
      await page.waitForTimeout(900);
      const hasBrowse = await page.locator('.browse').count();
      console.log(`  点击后 .browse 存在: ${hasBrowse > 0}`);
    } catch (e) {
      console.log(`  ✗ 点击失败: ${e.message.split('\n')[0]}`);
    }

    await ctx.close();
  }

  await browser.close();
})();
