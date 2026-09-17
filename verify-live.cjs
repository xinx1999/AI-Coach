/**
 * 线上站点验证：用真实 Chromium 打开 GitHub Pages 上的地址，
 * 检查渲染、控制台报错、以及动作图片是否真的加载出来。
 *
 * 为什么不能只靠 curl：curl 只能证明「文件在服务器上」，
 * 证明不了「浏览器能正确拼出地址并渲染」。base 路径配错时
 * HTML 照样 200，但页面是白的 —— 只有真的跑一遍才能发现。
 *
 * ⚠️ 关于图片断言：必须先把 loading 改成 eager。
 * 懒加载的图片在视口外时 naturalWidth 恒为 0，
 * 和「路径 404」在数值上完全一样，极易误判。
 */
const { chromium } = require('playwright-core');
const path = require('path');

const SITE = 'https://xiangx9.github.io/AI-Coach/';
const EXECUTABLE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';

let pass = 0;
let fail = 0;
function check(ok, label, extra = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors = [];
  const httpErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`);
  });

  console.log(`\n打开 ${SITE}\n`);
  const resp = await page.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
  check(resp && resp.status() === 200, '首页返回 200', resp ? `HTTP ${resp.status()}` : 'no response');

  // 应用真的渲染出来了（而不是白屏）
  await page.waitForSelector('#root', { timeout: 30000 });
  const rootText = (await page.locator('#root').innerText()).trim();
  check(rootText.length > 50, '应用已渲染内容', `#root 文本 ${rootText.length} 字符`);

  // 关键 UI 元素
  const navCount = await page.locator('nav a, nav button').count();
  check(navCount >= 3, '底部/顶部导航存在', `${navCount} 个入口`);

  const muscleChips = await page.locator('.muscle-chip-target').count();
  check(muscleChips > 0, '部位选择存在', `${muscleChips} 个`);

  // 切到动作库 —— 必须点导航按钮，不能用 page.goto(SITE + '#browse')。
  // hash 变化属于「同文档导航」，不会重新加载文档，React 也不一定重渲染；
  // 之前踩过这个坑：goto 之后 #root 一直是空的，看起来像白屏，实则是没切过去。
  await page.locator('.nav-btn', { hasText: '浏览' }).first().click();
  await page.waitForTimeout(3000);

  // 关键：把懒加载关掉，否则视口外的图必然 naturalWidth=0（假阳性）
  await page.evaluate(() => {
    document.querySelectorAll('img').forEach((img) => {
      img.loading = 'eager';
    });
  });
  await page.waitForTimeout(4000);

  const imgStats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    const media = imgs.filter((i) => i.src.includes('/media/'));
    return {
      total: imgs.length,
      media: media.length,
      loaded: media.filter((i) => i.complete && i.naturalWidth > 0).length,
      zero: media.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 5),
    };
  });

  console.log(`\n  图片统计: 总 ${imgStats.total}，其中 media/ ${imgStats.media}，加载成功 ${imgStats.loaded}`);
  if (imgStats.zero.length) {
    console.log('  加载失败的样例:');
    imgStats.zero.forEach((u) => console.log('    ' + u));
  }
  check(imgStats.media > 0, '页面引用了动作素材', `${imgStats.media} 张`);
  check(imgStats.loaded === imgStats.media && imgStats.media > 0, '动作素材全部加载成功', `${imgStats.loaded}/${imgStats.media}`);

  // Service Worker 是否注册成功
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length ? regs.map((r) => r.active ? 'active' : 'installing').join(',') : 'none';
  });
  check(swState === 'active', 'Service Worker 已激活', swState);

  // 控制台与网络
  check(consoleErrors.length === 0, '无控制台错误', consoleErrors.slice(0, 3).join(' | '));
  check(httpErrors.length === 0, '无 4xx/5xx 请求', httpErrors.slice(0, 3).join(' | '));

  await browser.close();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('验证脚本异常:', e.message);
  process.exit(2);
});
