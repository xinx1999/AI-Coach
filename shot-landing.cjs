/** 截取新版首次落点，用于人工核对 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 860, height: 1000 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();

  // 空手首次进入 → 计划页
  await p.goto('http://localhost:4199/', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.goto('http://localhost:4199/', { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'landing-plan.png' });
  console.log('已保存 landing-plan.png  (hash =', await p.evaluate(() => location.hash), ')');

  await b.close();
})();
