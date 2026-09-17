import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * 注册 Service Worker，让应用离线可用并支持装到桌面。
 *
 * 放在 load 之后而不是立即注册：不抢首屏的网络与主线程，避免拖慢首次渲染。
 *
 * 几个刻意的取舍：
 *  - 只在生产构建注册。开发时 SW 的缓存会让改代码不生效（要手动清缓存），
 *    这是最浪费时间的坑之一，所以用 import.meta.env.PROD 挡掉。
 *  - 注册失败只记日志、不打扰用户。隐私模式、老浏览器都会失败，
 *    但核心训练功能完全不受影响，没必要弹错误。
 *  - 路径用 import.meta.env.BASE_URL 而不是写死 '/sw.js'：
 *    部署在 GitHub Pages 子路径时脚本实际位于 /<仓库>/sw.js，
 *    写死根路径会 404，SW 永远注册不上 —— 离线能力整个失效，且只在生产暴露。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn('[sw] 注册失败，应用仍可正常使用：', err));
  });
}
