import { useEffect, useState } from 'react';

/** 生成短随机 id，用于组、动作项等本地实例标识 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 把一个值绑定到 localStorage 的某个键上。
 * 读取发生在首次渲染，写入在值变化时同步进行，
 * 因此刷新页面、浏览器被系统回收后再打开，状态都能续上。
 *
 * 一个容易踩的坑：值为 null / undefined 时不写。
 * 本应用是 hash 路由的单页，切换标签只是同文档导航，浏览器会重新求值模块，
 * React 也会重新挂载并跑一遍 effect；如果这里无条件 setItem，
 * 一个用户从没碰过的键就会被凭空创建成字符串 "null"，
 * 让「键不存在」和「值为 null」这两种本不同的状态混在一起。
 * 因此 null / undefined 一律视为「没有值」，直接 remove 掉而不是写进去。
 *
 * 另一个坑（本次修复）：读到 null 时要回落 initial，而不是把 null 交给调用方。
 * 历史版本留下的 "null" 字符串、或被手改过的存储，都会让 JSON.parse 得到 null。
 * 直接返回它会让 `workout.map(...)` 这类调用当场抛错、整页白屏——
 * 一份坏数据不该让应用打不开。null / undefined 一律视为「没有值」。
 *
 * @param validate 可选的形状校验。传入后，只有通过校验的值才会被采用，
 *   否则回落 initial。用于「必须是数组」这类约束：存储里可能是对象或字符串，
 *   光判断非 null 挡不住，交给调用方各自声明期望的形状最稳妥。
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  validate?: (v: unknown) => boolean,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as T;
      // parsed 可能是 null（存的是 "null"），此时必须回落 initial
      if (parsed === null || parsed === undefined) return initial;
      if (validate && !validate(parsed)) return initial;
      return parsed;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      // 存储配额耗尽（隐私模式、磁盘满）时静默降级为纯内存状态
    }
  }, [key, value]);

  return [value, setValue];
}
