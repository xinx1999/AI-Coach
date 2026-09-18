/**
 * 逐宽度截图，人工复核顶栏与各页面的实际观感。
 * 数字全绿不代表好看——「导航变成横向滚动条」就属于
 * 溢出为 0 但体验很差的情况，必须看图。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5173';
const EXECUTABLE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const OUT = path.join(__dirname, 'responsive-shots');

const SHOTS = [
  { w: 375, h: 812, name: 'phone-375', screens: ['plan', 'browse', 'timer'] },
  { w: 768, h: 1024, name: 'tablet-768', screens: ['plan', 'browse'] },
  { w: 1440, h: 900, name: 'desktop-1440', screens: ['plan', 'browse'] },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE });

  for (const s of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.w <= 480, hasTouch: s.w <= 768 });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    for (const scr of s.screens) {
      await page.locator('.nav-btn').first().click({ trial: true }).catch(() => {});
      const labelMap = { plan: '计划', browse: '浏览', timer: '计时', build: '编排', history: '历史' };
      const btn = page.locator('.nav-btn', { hasText: labelMap[scr] }).first();
      if (await btn.count()) await btn.click().catch(() => {});
      await page.waitForTimeout(1400);
      const f = path.join(OUT, `${s.name}-${scr}.png`);
      await page.screenshot({ path: f });
      console.log('  ✓ ' + path.basename(f));
    }
    await ctx.close();
  }

  await browser.close();
})();
