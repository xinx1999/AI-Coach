/**
 * 动作演示。
 *
 * ## 它要解决的问题
 *
 * 上游动图是「定格 1 秒 → 连放 5 张 100ms」的 4fps 循环（见 lib/gifFrames.ts 顶部注释），
 * 原速播出来就是「动一下、停半秒、动一下」，用户看不清关节角度和下放幅度。
 *
 * ## 这里怎么解决
 *
 * 两件事，缺一不可：
 *
 * 1. **剔掉定格帧**，只循环运动帧序列 —— 这是「动一下卡一下」的根因，
 *    不剔掉的话，放得再慢也只是一顿一顿地慢（见 gifFrames.ts）；
 * 2. **整体放慢 SLOWDOWN 倍** —— 运动帧之间从 100ms 拉长到 200ms。
 *    200ms 是能看清关节角度、又不会显得拖沓的节奏。
 *
 * 注意顺序：**先剔除、后放慢**。反过来的话定格帧也会被一起拉长，
 * 一个 1 秒的定格会变成 2 秒，比不放慢更难受。
 *
 * ## 为什么不联动步骤
 *
 * 做过三版，逐步收敛：
 *   1. 带暂停 / 逐帧 / 慢放 / 进度条 / 速度档的完整播放器 —— 否掉了，
 *      用户要的是「打开就看到动作在动」，不是「能操控」，一排控件是负担；
 *   2. 自动循环 + **可点**步骤列表（点第 k 步跳画面 + 反向高亮）—— 也否掉了。
 *      用户明确说「步骤 ↔ 画面对齐也不要了」。跳帧打断了连续观察，
 *      而且文字和帧的对应关系本来就不精确，硬绑反而让人分心；
 *   3. 现在这样：动图自己慢慢循环，下面单纯列出步骤文字。
 *
 * 所以这里刻意保持安静至极：**零交互**。不打断、不需要操作、没有可点元素。
 * 步骤列表退化成纯文字说明 —— 它和画面各自讲同一件事，不互相牵制。
 *
 * ## 降级
 *
 * 解码失败（文件损坏、格式异常）或用户开了「减少动态效果」时，回落到静态缩略图。
 * 宁可少一个功能，也不能留一块空白或者让动效惹人烦。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeGif, motionFrameIndices, type DecodedGif } from '../lib/gifFrames';

/**
 * 播放时长的放慢倍数。
 *
 * 2 倍 = 运动帧间隔从 100ms 拉到 200ms（5fps）。
 * 为什么是 2 而不是更大：素材总共只有 5～9 个运动帧，再慢就像卡住了；
 * 2 倍刚好让人看清起止姿态，又不至于等得不耐烦。
 */
const SLOWDOWN = 2;

/**
 * 单帧时长下限。放慢后仍不接受低于此值的帧 ——
 * 极短的帧在慢速播放里会一闪而过，还不如并入相邻帧。
 */
const MIN_FRAME_MS = 60;

interface Props {
  /** 动图地址；为空表示这个动作没有演示素材 */
  gifSrc: string | null;
  /** 静态缩略图，解码失败或不需要动画时用 */
  thumbSrc: string | null;
  /** 无障碍描述 */
  alt: string;
  /** 数据集自带的中文分步说明。仅作文字展示，不与画面联动 */
  steps: string[];
}

type Status = 'loading' | 'ready' | 'failed';

/** 尊重系统的「减少动态效果」偏好：开了就只显示静态图，不做任何动画 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function ExercisePlayer({ gifSrc, thumbSrc, alt, steps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<Status>(gifSrc ? 'loading' : 'failed');
  const [gif, setGif] = useState<DecodedGif | null>(null);
  /** 当前画到第几帧（真实帧号，不是运动序列下标） */
  const [frame, setFrame] = useState(0);

  const reducedMotion = useMemo(prefersReducedMotion, []);

  /**
   * 运动帧的下标序列。
   *
   * 数据集每个循环里夹着 1～3 处长定格（1000ms / 500ms），原速播过去就是
   * 「动一下卡一下」。这里把它们剔掉，只留连续运动的帧 ——
   * 播放基于这个序列，所以看到的动作是连贯的。
   *
   * 与 gif 一起在解码时确定，不单独用 memo 推导：
   * 它只是解码结果的函数，分开算容易出现「gif 已换、序列还是旧的」这种错位。
   */
  const [motion, setMotion] = useState<number[]>([0]);

  // ---------- 拉取并解码 ----------
  useEffect(() => {
    if (!gifSrc) {
      setStatus('failed');
      return;
    }
    let cancelled = false;
    setStatus('loading');

    (async () => {
      try {
        const res = await fetch(gifSrc);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const decoded = decodeGif(buf);
        if (cancelled) return;

        const frames = motionFrameIndices(decoded.frames);
        setGif(decoded);
        setMotion(frames);
        setFrame(frames[0]);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gifSrc]);

  // ---------- 把当前帧画到 canvas ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gif) return;
    canvas.width = gif.width;
    canvas.height = gif.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(gif.frames[frame].imageData, 0, 0);
  }, [gif, frame]);

  // ---------- 自动循环（放慢 SLOWDOWN 倍） ----------
  useEffect(() => {
    // 用户开了「减少动态效果」就不播 —— 尊重这个偏好比展示动画重要
    if (reducedMotion || status !== 'ready' || !gif) return;

    // 用 setTimeout 递归而不是 setInterval：
    // 每帧时长不同，间隔必须每帧重算。
    let timer: number;
    const tick = () => {
      const base = gif.frames[frame].durationMs;
      const waitMs = Math.max(MIN_FRAME_MS, base * SLOWDOWN);
      timer = window.setTimeout(() => {
        setFrame((f) => {
          // 在**运动帧序列**里前进一格，而不是帧号 +1。
          // 这样中间的长定格帧会被直接跳过 —— 那几处正是「动一下卡一下」的来源。
          const at = motion.indexOf(f);
          if (at < 0) return motion[0];
          return motion[(at + 1) % motion.length];
        });
      }, waitMs);
    };
    tick();

    return () => window.clearTimeout(timer);
  }, [reducedMotion, status, gif, frame, motion]);

  const showCanvas = status === 'ready' && gif;

  return (
    <div className="player">
      {/* 画面区。canvas 保持 1:1 逻辑尺寸由 CSS 缩放，
          这样高分屏上不会因为放大而发虚 —— 源图只有 180×180。 */}
      <div className="player-stage">
        {showCanvas ? (
          <canvas
            ref={canvasRef}
            className="player-canvas"
            role="img"
            aria-label={`${alt} 动作演示`}
          />
        ) : thumbSrc ? (
          /* 解码失败或无动图素材：退回静态图。
             不留空白框，也不显示报错 —— 用户不关心技术原因，只想看到动作。 */
          <img className="player-canvas player-static" src={thumbSrc} alt={`${alt} 动作示意`} />
        ) : (
          <div className="player-canvas player-none">暂无演示</div>
        )}

        {status === 'loading' && <div className="player-loading">正在加载演示…</div>}
      </div>

      {/* 分步说明。纯文字，**不可点** —— 点击跳帧会打断连续观察，
          而且文字和帧本来就不是精确对应的，硬绑反而分心。
          它只是把数据集的说明列出来，和画面各讲各的同一件事。 */}
      {steps.length > 0 && (
        <ol className="player-steps">
          {steps.map((s, i) => (
            <li key={i} className="player-step">
              <span className="player-step-no">{i + 1}</span>
              <span className="player-step-text">{s}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
