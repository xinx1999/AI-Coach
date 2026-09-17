import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages 的部署路径不能是根 `/`。
 *
 * 项目站点（project site）的真实地址是 https://<用户>.github.io/<仓库名>/，
 * 若 base 仍是默认的 `/`，打包出的 index.html 会引用 `/assets/index-xxx.js`，
 * 浏览器会去 https://<用户>.github.io/assets/... 取 —— 那是根域名的路径，必然 404，
 * 打开就是一片白屏。
 *
 * 所以 base 必须是 `/<仓库名>/`。但硬编码会让本地 `npm run dev`（服务在 `/`）
 * 出问题，因此做成可覆盖：
 *   - 本地开发 / preview：不设 → 走 `/`
 *   - CI（GitHub Actions）：注入 BASE_PATH=/<仓库名>/
 */
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // React 单独成 chunk：它体积大且很少变动，拆开后用户升级应用代码时无需重新下载
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
