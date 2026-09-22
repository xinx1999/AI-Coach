/** 只为截图：生成一份健身房计划，拍结果列表看场地胶囊的实际观感 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');
const BASE = process.env.BASE || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.goto(BASE + '/#plan');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.muscle-chip', { timeout: 15000 });

  // 选两个部位，让列表长一点、能看出混排
  await (await page.$('.muscle-chip:has-text("胸大肌")')).click();
  await (await page.$('.muscle-chip:has-text("背阔肌")')).click();
  // 切健身房
  await page.click('.wizard-seg-btn:has-text("健身房")');
  await page.click('.wizard-generate');
  await page.waitForSelector('.wizard-plan-item', { timeout: 15000 });

  await page.locator('.wizard-result').screenshot({ path: 'shot-plan-result.png' });
  console.log('OK shot-plan-result.png');
  await browser.close();
})();
