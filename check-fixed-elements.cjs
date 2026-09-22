/**
 * 补充：固定尺寸元素在窄屏下的适配检查。
 * 计时环、动作详情弹窗、训练完成弹窗这类元素最容易被写死宽高。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');
const path = require('path');

const BASE = 'http://localhost:4199';
const OUT = path.join(__dirname, 'responsive-shots');

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 1) 计时页
  await page.locator('.nav-btn', { hasText: '计时' }).first().click();
  await page.waitForTimeout(1200);
  const ring = await page.evaluate(() => {
    const r = document.querySelector('.timer-ring');
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), fits: b.left >= 0 && b.right <= window.innerWidth };
  });
  console.log(`  计时环: ${ring ? `${ring.w}×${ring.h} ${ring.fits ? '✓ 在视口内' : '✗ 超出'}` : '未找到'}`);
  await page.screenshot({ path: path.join(OUT, 'phone-375-timer.png') });

  // 2) 动作详情弹窗 —— 从浏览页点开第一张卡片
  await page.locator('.nav-btn', { hasText: '浏览' }).first().click();
  await page.waitForTimeout(1400);
  const card = page.locator('.exercise-card').first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(1200);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.detail-modal') || document.querySelector('.modal-card');
      if (!m) return null;
      const b = m.getBoundingClientRect();
      return {
        cls: m.className,
        w: Math.round(b.width),
        h: Math.round(b.height),
        left: Math.round(b.left),
        right: Math.round(b.right),
        bottom: Math.round(b.bottom),
        vw: window.innerWidth,
        vh: window.innerHeight,
        fitsX: b.left >= -1 && b.right <= window.innerWidth + 1,
        fitsY: b.bottom <= window.innerHeight + 1,
      };
    });
    console.log(`  详情弹窗: ${JSON.stringify(modal)}`);
    await page.screenshot({ path: path.join(OUT, 'phone-375-modal.png') });
    console.log('  ✓ 已截图 phone-375-modal.png');
  } else {
    console.log('  ✗ 未找到动作卡片');
  }

  await ctx.close();
  await browser.close();
})();
