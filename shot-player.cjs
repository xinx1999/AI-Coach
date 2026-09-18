/**
 * 播放器的三端截图，用于人工确认布局。
 *
 * 断言能抓住「溢出」这类硬问题，但抓不住「按钮挤成一团」「画面太小看不清」
 * 这类只有人眼能判断的问题，所以关键尺寸各截一张留档。
 */

process.env.BASE = process.env.BASE || 'http://localhost:4199';
const { chromium, executablePath, BASE } = require('./e2e-setup.cjs');
const fs = require('fs');

const OUT = 'player-shots';
const SIZES = [
  { w: 390, h: 844, name: '手机' },
  { w: 768, h: 1024, name: '平板' },
  { w: 1440, h: 900, name: '桌面' },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath });

  for (const s of SIZES) {
    const page = await browser.newPage({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: 2,
    });
    await page.goto(`${BASE}/#browse`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    // 打开第一个动作的详情
    await page.locator('.exercise-card').first().click();
    await page.waitForSelector('.player', { timeout: 15000 });
    await page
      .waitForFunction(() => !document.querySelector('.player-loading'), { timeout: 15000 })
      .catch(() => {});
    // 暂停，截图才能稳定（否则每张截到的帧都不同）
    const playBtn = page.locator('.player-btn-main');
    if ((await playBtn.count()) > 0) {
      const label = await playBtn.getAttribute('aria-label');
      if (label === '暂停') await playBtn.click();
    }
    await page.waitForTimeout(300);

    await page.screenshot({ path: `${OUT}/detail-${s.name}.png` });
    console.log(`  📸 detail-${s.name}.png  (${s.w}×${s.h})`);

    await page.close();
  }

  await browser.close();
  console.log(`\n截图已输出到 ${OUT}/`);
})().catch((e) => {
  console.error('异常:', e.message);
  process.exit(1);
});
