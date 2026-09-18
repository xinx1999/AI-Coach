/**
 * 诊断：谁盖住了导航按钮？
 * 用 elementFromPoint 取按钮中心点上的实际元素。
 */
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:5173';
const EXECUTABLE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(() => {
    const nav = document.querySelector('.app-nav');
    const out = [];
    for (const b of nav.querySelectorAll('.nav-btn')) {
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      const hitDesc = hit
        ? hit.tagName.toLowerCase() +
          (typeof hit.className === 'string' && hit.className ? '.' + hit.className.split(/\s+/).slice(0, 2).join('.') : '')
        : 'null';
      const isSelfOrChild = hit === b || (hit && b.contains(hit));
      out.push({
        text: b.textContent.trim().slice(0, 4),
        point: [cx, cy],
        hit: hitDesc,
        ok: isSelfOrChild,
      });
    }
    return out;
  });

  console.log('\n按钮中心点上的实际元素：\n');
  for (const r of result) {
    console.log(`  ${r.text.padEnd(4)} 点(${r.point[0]},${r.point[1]})  →  ${r.hit}  ${r.ok ? '✓ 是自己' : '✗ 被遮挡'}`);
  }

  // 进一步：看 header 的 z-index / 是否有覆盖层
  const layers = await page.evaluate(() => {
    const els = [...document.querySelectorAll('body *')];
    return els
      .filter((el) => {
        const cs = getComputedStyle(el);
        const z = parseInt(cs.zIndex, 10);
        return cs.position !== 'static' && !Number.isNaN(z) && z > 0;
      })
      .slice(0, 20)
      .map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''),
          z: cs.zIndex,
          pos: cs.position,
          rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        };
      });
  });

  console.log('\n有定位且有 z-index 的元素：\n');
  layers.forEach((l) => console.log(`  z=${String(l.z).padEnd(5)} ${l.pos.padEnd(9)} ${l.rect.padEnd(22)} ${l.el}`));

  await ctx.close();
  await browser.close();
})();
