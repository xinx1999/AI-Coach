import { useEffect, useState } from 'react';

/** 生成短随机 id，用于组、动作项等本地实例标识 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 把一个值绑定到 localStorage 的某个键上。
 * 读取发生在首次渲染，写入在值变化时同步进行，
 * 因此刷新页面、浏览器被系统回收后再打开，状态都能续上。
 */
export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储配额耗尽（隐私模式、磁盘满）时静默降级为纯内存状态
    }
  }, [key, value]);

  return [value, setValue];
}
