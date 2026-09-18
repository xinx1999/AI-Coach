/**
 * 动作演示。
 *
 * ## 它要解决的问题
 *
 * 上游动图是「定格 1 秒 → 连放 5 张 100ms」的 4fps 循环（见 lib/gifFrames.ts 顶部注释），
 * 原速播出来就是「动一下、停半秒、动一下」，用户看不清关节角度和下放幅度。
 * 数据集自带的 5～9 条分步说明又只是被动地堆在图下面，
 * 文字讲第 3 步时画面可能正停在定格帧上 —— 两者对不上，等于没有。
 *
 * ## 这里怎么解决
 *
 * 1. **剔掉定格帧**，只循环运动帧序列，动作因此是连贯的（核心，见 gifFrames.ts）；
 * 2. **步骤列表可点**，点第 k 步画面直接跳到对应帧，同时自动播放时反向高亮当前步骤 ——
 *    文字和画面终于对上了。
 *
 * ## 为什么没有播放控制
 *
 * 做过一版带暂停 / 逐帧 / 慢放 / 进度条 / 速度档的播放器，但被否掉了：
 * 用户要的是「打开就看到动作在动、且看得懂」，不是「能操控」。
 * 一堆控件占掉了画面下方的空间，反而是负担。
 * 慢放的价值已经由「剔除定格帧 + 只循环运动段」替代 —— 那才是让动作变连贯的关键，
 * 跟有没有控制条无关。
 *
 * 所以这里刻意保持安静：自动循环、不打断、不需要操作。
 * 唯一保留的交互是「点步骤跳画面」，因为它解决的是「看不懂」而不是「不好用」。
 *
 * ## 降级
 *
 * 解码失败（文件损坏、格式异常）或用户开了「减少动态效果」时，回落到静态缩略图。
 * 宁可少一个功能，也不能留一块空白或者让动效惹人烦。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { decodeGif, motionFrameIndices, stepToFrame, type DecodedGif } from '../lib/gifFrames';

interface Props {
  /** 动图地址；为空表示这个动作没有演示素材 */
  gifSrc: string | null;
  /** 静态缩略图，解码失败或不需要动画时用 */
  thumbSrc: string | null;
  /** 无障碍描述 */
  alt: string;
  /** 数据集自带的中文分步说明 */
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
  /** 当前高亮的步骤。null = 还没开始跟 */
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const reducedMotion = useMemo(prefersReducedMotion, []);

  /**
   * 运动帧的下标序列。
   *
   * 数据集每个循环里夹着 1～3 处长定格（1000ms / 500ms），原速播过去就是
   * 「动一下卡一下」。这里把它们剔掉，只留连续运动的帧 ——
   * 播放和步骤映射都基于这个序列，所以看到的动作是连贯的。
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

  // ---------- 自动循环 ----------
  useEffect(() => {
    // 用户开了「减少动态效果」就不播 —— 尊重这个偏好比展示动画重要
    if (reducedMotion || status !== 'ready' || !gif) return;

    // 用 setTimeout 递归而不是 setInterval：
    // 每帧时长不同，间隔必须每帧重算。
    let timer: number;
    const tick = () => {
      const waitMs = gif.frames[frame].durationMs;
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

  /** 点步骤：跳到该步骤对应的帧。这正是「看清动作」的关键 ——
   *  文字和画面终于对上了，而不是各说各的。 */
  const goToStep = useCallback(
    (index: number) => {
      if (!gif) return;
      setActiveStep(index);
      setFrame(stepToFrame(index, steps.length, motion));
    },
    [gif, steps.length, motion],
  );

  /**
   * 播放时反向高亮步骤：画面走到哪一帧，就点亮对应的那条说明。
   *
   * 取**最近的**步骤，而不是「帧号不超过当前帧的最后一步」（向下取整）。
   * 向下取整在循环回绕处会出错：点最后一步会跳到运动序列的末帧，
   * 下一拍自动播放把它推回 motion[0]，此时「不超过第 0 帧的最后一步」
   * 就是第 1 步 —— 高亮在 100ms 内从最后一步弹回第一步，看着像点击失效。
   * 按距离最近来选，回绕前后都稳定落在同一侧。
   */
  useEffect(() => {
    if (status !== 'ready' || !gif || steps.length === 0) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < steps.length; i += 1) {
      const dist = Math.abs(stepToFrame(i, steps.length, motion) - frame);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setActiveStep(best);
  }, [status, frame, gif, steps.length, motion]);

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

      {/* 分步说明。点一条就跳到对应画面 —— 这是「看懂动作」的关键。
          没有控制条，用户唯一的操作就是这里。 */}
      {steps.length > 0 && (
        <ol className="player-steps">
          {steps.map((s, i) => (
            <li key={i}>
              <button
                className={`player-step ${activeStep === i ? 'on' : ''}`}
                onClick={() => goToStep(i)}
                aria-current={activeStep === i ? 'step' : undefined}
                disabled={!showCanvas}
              >
                <span className="player-step-no">{i + 1}</span>
                <span className="player-step-text">{s}</span>
                {activeStep === i && showCanvas && (
                  <ChevronRight size={13} className="player-step-arrow" />
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
