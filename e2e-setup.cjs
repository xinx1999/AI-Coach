/**
 * e2e 脚本的公共引导：定位 playwright 和浏览器可执行文件。
 *
 * ## 为什么要单独抽一个文件
 *
 * 项目里已经有 5 个以上的 e2e / 诊断脚本，每个开头都在重复同一段
 * 「require playwright-core + 拼浏览器路径」。这些路径**换台机器就会失效**：
 *   - npm 全局目录随 npm prefix 变化；
 *   - playwright 换版本时目录名从 `chromium_headless_shell-1234` 变成别的；
 *   - 新版还把 `chrome-win/headless_shell.exe` 改成了
 *     `chrome-headless-shell-win64/chrome-headless-shell.exe`。
 * 复制 5 份意味着改一次要改 5 处，漏一个就得到「Cannot find module」这种
 * 和真实原因毫无关系的报错。统一到这里，只维护一份。
 *
 * ## 为什么不装成项目依赖
 *
 * playwright 会带一份几十 MB 的 chromium。写进 package.json 后，
 * 每次 `npm install`（包括 CI 里只为了构建的那次）都会把它拉下来，
 * 而 CI 根本不跑浏览器测试。所以保持可选依赖，用的时候探测。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * 解析 playwright-core 模块。
 *
 * 注意不能用 process.env.APPDATA —— Git Bash 下它是 undefined
 * （那是 Windows 原生命令行的变量），os.homedir() 才跨 shell 都成立。
 */
function resolvePlaywright() {
  const home = os.homedir();
  const candidates = [
    'playwright-core',
    path.join(home, 'AppData/Roaming/npm/node_modules/playwright/node_modules/playwright-core'),
    path.join(home, 'AppData/Roaming/npm/node_modules/playwright-core'),
  ];
  for (const c of candidates) {
    try {
      if (c === 'playwright-core' || fs.existsSync(c)) return require(c);
    } catch {
      /* 继续试下一个 */
    }
  }
  console.error(
    '\n找不到 playwright-core。安装方式（任选其一）：\n' +
      '  npm i -g playwright && npx playwright install chromium\n' +
      '  npm i -D playwright-core   # 然后自行准备浏览器\n',
  );
  process.exit(1);
}

/**
 * 找 chromium 可执行文件。
 *
 * 不硬编码路径：playwright 换版本时目录会变（1234 和 1210 曾并存），
 * 且新版把 headless_shell 的目录和文件名都改了。
 * 所以扫描 ms-playwright 目录，按目录名倒序取版本最高的那个。
 */
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  if (!fs.existsSync(root)) return undefined;

  const dirs = fs
    .readdirSync(root)
    .filter((d) => d.startsWith('chromium'))
    .sort()
    .reverse();

  // 每组里按优先级试：完整版 chrome 优先于 headless_shell
  const layouts = [
    ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
    ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win/headless_shell.exe'],
  ];
  for (const group of layouts) {
    for (const dir of dirs) {
      for (const rel of group) {
        const p = path.join(root, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const { chromium } = resolvePlaywright();
const executablePath = findChromium();

if (!executablePath) {
  console.error(
    '\n找不到 chromium。先安装：npx playwright install chromium\n' +
      '或设置 CHROME_PATH 指向已有的 Chrome。\n',
  );
  process.exit(1);
}

/** 目标站点。默认本地 dev；设 BASE 可指向 preview 或线上 */
const BASE = process.env.BASE || 'http://localhost:5173';
/** 线上环境要放宽超时 —— 首次加载还要拉 100MB+ 的动图 */
const IS_REMOTE = /^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(BASE);

module.exports = { chromium, executablePath, BASE, IS_REMOTE };
