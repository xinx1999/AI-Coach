/**
 * 放大截取顶栏，确认没有像素级的错位或残影。
 * 用 canvas 在浏览器里做缩放，避免引入额外依赖。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXECUTABLE } = require('./e2e-setup.cjs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  for (const w of [320, 375, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, isMobile: w <= 480, hasTouch: w <= 768, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const el = page.locator('.app-header');
    const f = path.join(__dirname, 'responsive-shots', `_header-${w}.png`);
    await el.screenshot({ path: f });
    console.log('  ✓ ' + path.basename(f));
    await ctx.close();
  }
  await browser.close();
})();
