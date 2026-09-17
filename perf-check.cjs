const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:4199';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const page = await ctx.newPage();

  // 模拟普通 4G（下行 ~10Mbps）下冷启动
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
    latency: 60,
  });

  await page.goto(`${BASE}/#browse`, { waitUntil: 'load' });

  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');
    const res = performance.getEntriesByType('resource');
    const biggest = res
      .map((r) => ({ n: r.name.split('/').pop(), s: r.transferSize, d: Math.round(r.duration) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 4);
    return {
      domInteractive: Math.round(nav.domInteractive),
      domComplete: Math.round(nav.domComplete),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      biggest,
    };
  });
  console.log('10Mbps 模拟网络：');
  console.log('  首次内容绘制 FCP:', t.fcp, 'ms');
  console.log('  DOM 可交互:', t.domInteractive, 'ms');
  console.log('  页面完全就绪:', t.domComplete, 'ms');
  console.log('  最大资源:', JSON.stringify(t.biggest));

  // 页面本身可交互后，卡片渲染要多久
  const t2 = await page.evaluate(async () => {
    const start = performance.now();
    await new Promise((r) => {
      if (document.querySelector('.exercise-card')) return r();
      const io = new MutationObserver(() => {
        if (document.querySelector('.exercise-card')) { io.disconnect(); r(); }
      });
      io.observe(document.body, { childList: true, subtree: true });
      setTimeout(r, 5000);
    });
    return Math.round(performance.now() - start);
  });
  console.log('  首张卡片出现:', t2, 'ms');

  const imgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.card-media img')).map((i) => ({
      ok: i.complete && i.naturalWidth > 0,
      lazy: i.loading,
    })),
  );
  console.log(`  卡片图懒加载: ${imgs.filter((i) => i.lazy === 'lazy').length}/${imgs.length} 标记为 lazy`);

  await browser.close();
})();
