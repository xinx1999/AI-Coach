/**
 * 动作分步说明的异步加载。
 *
 * ## 为什么要有这个文件
 *
 * `steps` 一个字段占了 catalog.json 的 **42.8%**（469KB raw / 72KB gzip），
 * 但只有**详情页和计时页**用得上 —— 浏览列表、筛选、搜索、生成计划都不用。
 * 放在 catalog.json 里就意味着：每次首屏都要下载并解析 1318 个动作的完整步骤，
 * 只为渲染一个 60 张卡片的列表。
 *
 * 所以 `scripts/build-catalog.cjs` 把它拆成了 `public/catalog-steps.json`，
 * 首屏 JS 从 245.5KB gzip 降到约 165KB（−33%）。
 *
 * ## 加载时机
 *
 * `App.tsx` 挂载后立刻调用 `loadSteps()`（**不 await**）。
 * 这样步骤的请求与首屏渲染并行，而不是等用户点进详情页才开始 ——
 * 实测用户从首屏到点开一个动作通常要 1 秒以上，步骤基本都已经就位，
 * 所以正常使用下看不到「步骤后出现」的跳动。
 *
 * ## 为什么是 fetch 而不是 import()
 *
 * 两者都能拆包，但 `public/` 下的文件不参与构建哈希，
 * 也就不需要每次构建都重新下载（SW 按路径缓存）。
 * 数据内容变不变跟代码版本无关，用固定路径更合适。
 *
 * ## 离线
 *
 * SW 的策略按资源性质分（见 public/sw.js）。这个文件在启动时就会请求，
 * 首次访问即被缓存，所以「进健身房没信号」时步骤照常可用 ——
 * 这是不能退化的一条，改动这里时务必确认。
 */

/** 无步骤时返回同一个空数组，避免 useSyncExternalStore 因引用变化死循环 */
export const EMPTY_STEPS: string[] = [];
const EMPTY = EMPTY_STEPS;

type StepsMap = Record<string, string[]>;

let map: StepsMap | null = null;
let promise: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** 步骤是否已就位（用于需要区分「还没加载」和「确实没有步骤」的场景） */
export function stepsReady(): boolean {
  return map !== null;
}

/**
 * 加载步骤数据。可重复调用，只会真正请求一次。
 * 失败不抛错 —— 步骤是增强内容，拿不到不该让页面挂掉。
 */
export function loadSteps(): Promise<void> {
  if (promise) return promise;

  const url = `${import.meta.env.BASE_URL}catalog-steps.json`;
  promise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data: StepsMap) => {
      map = data;
      listeners.forEach((f) => f());
    })
    .catch((err) => {
      // 不吞：步骤拿不到要能查出来。但不阻断渲染，也不弹窗 ——
      // 用户看到的是「没有步骤」，而不是一个报错对话框。
      console.warn('[steps] 加载失败，分步说明将不可用：', err);
    });

  return promise;
}

/** 取某个动作的步骤（键是 `exercise.slug`）。未加载完 / 该动作没有步骤时返回空数组 */
export function stepsFor(slug: string): string[] {
  return map?.[slug] ?? EMPTY;
}

/** 供 useSyncExternalStore 订阅加载完成事件 */
export function subscribeSteps(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
