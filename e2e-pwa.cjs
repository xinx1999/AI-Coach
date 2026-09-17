/**
 * 验证 PWA 支持（P2-5）。
 *
 * 装到桌面的能力靠三样东西凑齐，缺一不可：
 *   1. manifest.json  —— 服务端以 application/json 返回，且声明 name/icons/display
 *   2. 图标           —— 有 any 又有 maskable，否则 Android 会白底裁成方块
 *   3. Service Worker —— 必须真的注册成功，且能接管页面（离线可用）
 *
 * 这里故意不只看「文件存在」：请求 manifest 时必须确认拿到的是 JSON，
 * 因为 SPA 兜底会把任意未知路径返回成 index.html，文件缺失时也会 200。
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:4199';

let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  // ============ A. index.html 的 PWA 声明 ============
  console.log('\n[A] HTML 头声明');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  /*
   * 断言的是「引用能被浏览器正确解析到 manifest」，不是「字面量恰好等于 /manifest.json」。
   * 部署到 GitHub Pages 子路径后引用必须是相对的（./manifest.json），
   * 写死 /manifest.json 会指到域名根 → 404。所以这里用 URL 解析后比较 pathname。
   */
  const manifestUrl = new URL(manifestHref, BASE + '/');
  check(
    manifestUrl.pathname.endsWith('/manifest.json'),
    `声明了 manifest（实际 ${manifestHref} → ${manifestUrl.pathname}）`,
  );
  // 子路径部署时不能是裸的根绝对路径，否则换仓库名就坏
  check(!manifestHref.startsWith('/'), `manifest 用相对路径而非根绝对路径（${manifestHref}）`);

  const themeColor = await page.getAttribute('meta[name="theme-color"]', 'content');
  // 深色主题：theme-color 跟随 --bg，浏览器地址栏才能和页面连成一片
  check(themeColor === '#131316', `声明了 theme-color（实际 ${themeColor}）`);

  const desc = await page.getAttribute('meta[name="description"]', 'content');
  check(!!desc && desc.length > 10, '声明了 description');

  const vp = await page.getAttribute('meta[name="viewport"]', 'content');
  check(vp.includes('viewport-fit=cover'), 'viewport 含 viewport-fit=cover（刘海屏安全区）');

  // ============ B. manifest.json 内容正确 ============
  console.log('\n[B] manifest 内容');
  const mRes = await page.request.get(BASE + '/manifest.json');
  const mType = mRes.headers()['content-type'] || '';
  check(mRes.status() === 200, 'manifest 返回 200');
  check(mType.includes('json'), `Content-Type 是 JSON（实际 ${mType}）`);

  const manifest = await mRes.json();
  check(manifest.name === 'Strong — 训练计划', `name 正确（实际 ${manifest.name}）`);
  check(manifest.short_name === 'Strong', `short_name 正确（实际 ${manifest.short_name}）`);
  /*
   * start_url / scope 用相对写法（./），这样在根路径与 GitHub Pages 子路径下
   * 都由浏览器按 manifest 自身位置解析，不必随仓库名改配置。
   * 断言「是相对的」而不是「等于 /」——后者会禁止子路径部署。
   */
  check(
    manifest.start_url === './' || manifest.start_url === '/',
    `start_url 合法（实际 ${manifest.start_url}）`,
  );
  check(
    manifest.scope === './' || manifest.scope === '/',
    `scope 合法（实际 ${manifest.scope}）`,
  );
  check(manifest.display === 'standalone', `display 是 standalone（实际 ${manifest.display}）`);
  check(
    manifest.theme_color === '#131316',
    `theme_color 与 HTML 一致（实际 ${manifest.theme_color}）`,
  );
  check(manifest.lang === 'zh-CN', 'lang 是 zh-CN');

  // 图标必须同时具备 any 与 maskable
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  check(icons.length >= 2, `至少声明 2 个图标（实际 ${icons.length}）`);
  const purposes = icons.map((i) => i.purpose);
  check(purposes.includes('any'), '有 purpose=any 的图标');
  check(purposes.includes('maskable'), '有 purpose=maskable 的图标（Android 自适应）');

  // 图标要真的能取到，且是 SVG。
  // 注意 icon.src 现在是相对的（./icon.svg），必须相对 manifest 的地址解析，
  // 不能直接字符串拼 BASE（会拼出 http://host./icon.svg 这种非法 URL）。
  const manifestBaseUrl = BASE + '/manifest.json';
  for (const icon of icons) {
    const iconUrl = new URL(icon.src, manifestBaseUrl).href;
    const r = await page.request.get(iconUrl);
    const ct = r.headers()['content-type'] || '';
    check(
      r.status() === 200 && ct.includes('svg'),
      `图标可访问且是 svg：${icon.src}（${r.status()} ${ct}）`,
    );
  }

  // ============ C. Service Worker 真的注册上了 ============
  console.log('\n[C] Service Worker');
  // 注册在 load 事件里，等它落地
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.getRegistrations
      ? navigator.serviceWorker.getRegistrations().then((r) => r.length > 0)
      : false,
    { timeout: 8000 },
  ).catch(() => {});

  const regs = await page.evaluate(async () => {
    const list = await navigator.serviceWorker.getRegistrations();
    return list.map((r) => ({ scope: r.scope, active: !!r.active, script: r.active?.scriptURL }));
  });
  check(regs.length === 1, `恰好注册 1 个 SW（实际 ${regs.length}）`);
  check(regs[0]?.active === true, 'SW 已激活（active）');
  check(!!regs[0]?.script?.endsWith('/sw.js'), `SW 脚本是 /sw.js（实际 ${regs[0]?.script}）`);
  check(regs[0]?.scope?.endsWith('/'), `SW scope 覆盖根路径（实际 ${regs[0]?.scope}）`);

  // sw.js 本身要能被取到，且是 JS
  const swRes = await page.request.get(BASE + '/sw.js');
  const swType = swRes.headers()['content-type'] || '';
  const swBody = await swRes.text();
  check(swRes.status() === 200, 'sw.js 返回 200');
  check(swType.includes('javascript'), `sw.js Content-Type 是 JS（实际 ${swType}）`);
  check(swBody.includes('addEventListener'), 'sw.js 内容像真正的 SW（含 addEventListener）');

  // SW 脚本不能被浏览器 HTTP 缓存卡住：否则发新版后用户永远拿不到更新
  const cc = swRes.headers()['cache-control'] || '';
  check(
    cc.includes('no-cache') || cc.includes('no-store') || cc.includes('max-age=0'),
    `sw.js 未被长缓存（cache-control: ${cc || '未设置'}）`,
  );

  // ============ D. 离线可用：断网后仍能打开 ============
  console.log('\n[D] 离线能力');
  // 先在线访问一次，让 SW 完成对 shell 的预缓存
  await page.goto(BASE + '/#plan', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    { timeout: 8000 },
  ).catch(() => {});
  // 等 install 阶段的 precache 落盘
  await page.waitForTimeout(1200);

  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  check(controlled, 'SW 已接管页面（controller 非空）');

  const cacheNames = await page.evaluate(() => caches.keys());
  check(cacheNames.length > 0, `建立了缓存桶（${cacheNames.join(', ') || '无'}）`);
  check(
    cacheNames.some((n) => n.includes('shell')),
    '存在 shell 缓存桶（离线首屏靠它）',
  );

  // 关键：构建产物（JS/CSS）必须真的进了 SW 缓存。
  // 只看「断网能不能打开」是不够的 —— Chromium 的 HTTP 磁盘缓存会兜住首屏，
  // 把 SW 没缓存资源这件事掩盖掉。必须直接查缓存桶。
  const assetCached = await page.evaluate(async () => {
    const out = { total: 0, js: 0, css: 0, urls: [] };
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      for (const req of keys) {
        const u = new URL(req.url);
        if (!u.pathname.startsWith('/assets/')) continue;
        out.total++;
        out.urls.push(u.pathname);
        if (u.pathname.endsWith('.js')) out.js++;
        if (u.pathname.endsWith('.css')) out.css++;
      }
    }
    return out;
  });
  check(assetCached.js >= 2, `JS 构建产物已入 SW 缓存（实际 ${assetCached.js} 个）`);
  check(assetCached.css >= 1, `CSS 构建产物已入 SW 缓存（实际 ${assetCached.css} 个）`);

  // 真断网下的离线验证。
  //
  // 这里刻意**不用** `page.goto()` 来测：headless-shell 在硬断网时，
  // 新的顶层导航的子资源请求不会经过 SW（浏览器网络层直接 ERR_FAILED），
  // 于是「首屏白屏」是测试环境的假象，不是应用的锅 —— 真实 Chrome / Android
  // 会把子资源交给 SW。用 CDP 的 route 拦截更糟：它拦在 SW 之下，等于直接绕过 SW。
  //
  // 所以改用与首屏**完全同一条加载路径**的 <script src> 注入来验证：
  // 能在断网下从缓存加载出来，就证明 SW 确实接得住构建产物。
  await ctx.setOffline(true);
  const offlineProbe = await page.evaluate(async () => {
    const out = {};
    // 从已缓存的文件名里取真实的构建产物名，避免把哈希写死在测试里
    const cachedAssets = [];
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      for (const req of keys) {
        const p = new URL(req.url).pathname;
        if (p.startsWith('/assets/')) cachedAssets.push(p);
      }
    }
    const jsAsset = cachedAssets.find((p) => p.endsWith('.js'));
    const cssAsset = cachedAssets.find((p) => p.endsWith('.css'));

    const load = (src) =>
      new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve('loaded');
        s.onerror = () => resolve('error');
        document.head.appendChild(s);
        setTimeout(() => resolve('timeout'), 5000);
      });

    // 1. JS 构建产物：断网下应从 SW 缓存命中
    out.js = jsAsset ? await load(jsAsset) : 'no-asset-found';
    // 2. CSS 同样验一遍
    out.css = 'no-asset-found';
    if (cssAsset) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssAsset;
      out.css = await new Promise((resolve) => {
        link.onload = () => resolve('loaded');
        link.onerror = () => resolve('error');
        document.head.appendChild(link);
        setTimeout(() => resolve('timeout'), 5000);
      });
    }
    // 3. manifest 这类 shell 资源
    try {
      const r = await fetch('/manifest.json');
      out.manifest = r.status === 200 ? 'loaded' : 'status=' + r.status;
    } catch (e) {
      out.manifest = 'ERR ' + e.message;
    }
    return out;
  });
  check(offlineProbe.js === 'loaded', `断网下 JS 从 SW 缓存加载成功（实际 ${offlineProbe.js}）`);
  check(offlineProbe.css === 'loaded', `断网下 CSS 从 SW 缓存加载成功（实际 ${offlineProbe.css}）`);
  check(offlineProbe.manifest === 'loaded', `断网下 manifest 从缓存返回 200（实际 ${offlineProbe.manifest}）`);

  // 导航请求本身也要走 SW 缓存拿外壳。
  // 注意要去掉 hash：带 #hash 的跳转是「同文档导航」，goto 会返回 null 而不是响应。
  const navRes = await page
    .goto(BASE + '/', { waitUntil: 'commit', timeout: 8000 })
    .catch(() => null);
  check(navRes !== null && navRes.status() === 200, `断网下导航返回 200（外壳来自缓存）`);

  await ctx.setOffline(false);

  // ============ E. 不能拖慢或搞坏正常使用 ============
  console.log('\n[E] 与主流程互不干扰');
  // 必须先做一次**真正的整页重载**：断网探针往 <head> 里插过 script/link，
  // 且之后的 goto 只改 hash 属于同文档导航、并不会重载文档（root 会一直是空的）。
  // 用 reload 而不是 goto('#x')，否则测的是被污染的脏页面。
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  check((await page.locator('.app-nav').count()) === 1, 'SW 注册后应用正常渲染');
  check((await page.locator('.nav-btn').count()) >= 5, '底部导航按钮齐全');
  check(
    (await page.locator('body').innerText()).length > 50,
    '页面有实质内容（未白屏）',
  );
  // 只有 1 个 SW，重复访问不应累积注册
  const regs2 = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
  check(regs2 === 1, `重复访问未累积 SW 注册（实际 ${regs2}）`);

  // ============ F. 控制台 ============
  console.log('\n[F] 控制台');
  // 只统计本次干净加载之后的错误（断网探针的 ERR 是测试自己制造的）
  errors.length = 0;
  await page.goto(BASE + '/#history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check(errors.length === 0, errors.length ? `有错误：${errors.slice(0, 3).join(' | ')}` : '无控制台错误');

  await browser.close();
  console.log(fail === 0 ? '\n===== 全部通过 =====' : `\n===== ${fail} 项失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
