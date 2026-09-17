/**
 * Strong 训练器的 Service Worker。
 *
 * 目标（按价值排序）：
 *  1. **离线可用**。训练时可能在没信号的健身房地下室。素材全在本地，
 *     没有理由因为网络断了就打不开——这是加 SW 最主要的理由。
 *  2. **秒开**。缓存的 HTML/JS/CSS 直接命中，不必每次回源。
 *  3. 配合 App 侧「截止时间戳」计时方案，减少后台标签页被节流的影响。
 *
 * 缓存策略按资源性质分开，不用「一刀切缓存优先」——那会让发新版本后
 * 用户一直拿到旧代码，这是 SW 最常见的坑：
 *  - 导航请求（HTML）：**网络优先**，保证总能拿到最新版；离线时回落缓存。
 *  - 构建产物（/assets/，文件名带内容哈希）：**缓存优先**，文件内容不变，
 *    可以放心长期缓存。
 *  - 动作媒体（/media/）：**缓存优先**，体积大且内容不变。
 *  - manifest / 图标：缓存优先。
 *
 * 版本号变更会让旧缓存在 activate 时被清理，避免缓存无限膨胀。
 *
 * ⚠️ 部署在子路径（GitHub Pages 项目站点）时必须知道自己的 base，否则整条链路失效。
 * 下面所有路径都基于 BASE 派生，绝不能写成裸的 `/assets/`：
 * 部署到 https://<用户>.github.io/<仓库>/ 时，资源实际在 /<仓库>/assets/ 下，
 * 写死 `/assets/` 会既不命中缓存也拦不到请求 —— 离线直接白屏。
 * BASE 从 SW 脚本自身的 scope 推导，本地（`/`）与子路径都能自适应。
 */

const VERSION = 'v3';
const SHELL_CACHE = `strong-shell-${VERSION}`;
const ASSET_CACHE = `strong-assets-${VERSION}`;
const MEDIA_CACHE = `strong-media-${VERSION}`;

/**
 * 本站的部署根路径，结尾带斜杠：本地是 `/`，Pages 上是 `/<仓库>/`。
 *
 * `self.registration.scope` 形如 `https://host/<仓库>/`（SW 放在 public/ 根下，
 * 所以 scope 就是部署根）。取它的 pathname 即得 base，不必让构建注入变量 ——
 * SW 是纯静态文件，走构建替换会引入额外的注入步骤。
 */
const BASE = new URL(self.registration.scope).pathname.replace(/\/+$/, '/');

/** 把站内路径（以 `/` 开头）按 BASE 前缀化 */
function withBase(p) {
  return BASE + p.replace(/^\/+/, '');
}

/** 预缓存：应用外壳。即使首次离线打开也能渲染 */
const SHELL_URLS = ['', 'index.html', 'manifest.json', 'icon.svg', 'icon-maskable.svg'].map(withBase);

/**
 * 从 index.html 里解析出构建产物的地址（assets/xxx.js|css）。
 *
 * 为什么非要手动解析：SW 在 `load` 之后才注册，等它拿到控制权时，
 * 首屏的 JS/CSS 早已发完请求了——**这一轮的 assets 分支根本不会执行**。
 * 只靠 fetch 事件里的「缓存优先 + 回写」，首次访问就什么都不会入缓存，
 * 用户断网再打开就只剩一个空壳 HTML。所以这里必须主动抓一次。
 *
 * 注意匹配的是「以 base+assets/ 开头」而不是裸的 `/assets/`：
 * 构建产物在子路径部署下是 `/<仓库>/assets/...`。
 */
function parseAssetUrls(html, baseUrl) {
  const urls = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  const assetPrefix = withBase('assets/');
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    // 允许相对写法（./assets/xxx）与绝对写法（/<仓库>/assets/xxx）
    const resolved = (() => {
      try {
        return new URL(raw, baseUrl);
      } catch {
        return null;
      }
    })();
    if (!resolved) continue;
    if (!resolved.pathname.startsWith(assetPrefix)) continue;
    urls.add(resolved.href);
  }
  return [...urls];
}

/** 判断某个 pathname 是否落在指定子目录下（按 BASE 前缀化后比较） */
function underBase(pathname, sub) {
  return pathname.startsWith(withBase(sub));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 单个文件失败不应让整个安装失败（例如某张图标暂时 404）
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))));

      // 外壳之外的构建产物：解析 index.html 后逐个抓进 ASSET_CACHE。
      // 用 no-store 绕过 HTTP 缓存，确保拿到的是当前这一版的真实文件。
      try {
        const res = await fetch(withBase('index.html'), { cache: 'no-store' });
        if (res.ok) {
          const html = await res.text();
          const assetCache = await caches.open(ASSET_CACHE);
          await Promise.allSettled(
            parseAssetUrls(html, self.location.origin).map((href) =>
              assetCache.add(new Request(href, { cache: 'reload' })),
            ),
          );
        }
      } catch {
        /* 离线安装等场景：跳过，后续由 fetch 分支按需补齐 */
      }

      // 新 SW 立即进入等待态，配合下面的 skipWaiting 让它马上生效
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉所有旧版本缓存，只留当前版本
      const keys = await caches.keys();
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, MEDIA_CACHE]);
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** 把响应放进指定缓存（只缓存成功的同源响应） */
async function putInCache(cacheName, request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只处理同源 GET。跨域（授权链接等）和应用自身的写操作一律放行
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const shellUrl = withBase('index.html');

  // ---- 1. 导航请求：网络优先，离线回落 ----
  // 必须网络优先，否则发版后用户会一直看到旧页面
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          await putInCache(SHELL_CACHE, shellUrl, fresh);
          return fresh;
        } catch {
          const cached = await caches.match(shellUrl);
          if (cached) return cached;
          // 连外壳都没缓存过（首次访问就离线），只能如实报错
          return new Response('离线且没有可用缓存', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // ---- 2. 构建产物：缓存优先（文件名带内容哈希，内容永不变） ----
  if (underBase(url.pathname, 'assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        await putInCache(ASSET_CACHE, request, fresh);
        return fresh;
      })(),
    );
    return;
  }

  // ---- 3. 动作媒体：缓存优先，且不预缓存（138MB，按需缓存即可） ----
  if (underBase(url.pathname, 'media/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          await putInCache(MEDIA_CACHE, request, fresh);
          return fresh;
        } catch {
          // 媒体取不到时给一个 1x1 透明占位，避免整张卡片显示破图
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            { status: 200, headers: { 'content-type': 'image/svg+xml' } },
          );
        }
      })(),
    );
    return;
  }

  // ---- 4. 其余同源静态资源：缓存优先 + 后台更新 ----
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then(async (fresh) => {
          await putInCache(SHELL_CACHE, request, fresh);
          return fresh;
        })
        .catch(() => null);

      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;
      return new Response('资源不可用', { status: 504 });
    })(),
  );
});
