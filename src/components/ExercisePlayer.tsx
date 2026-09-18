/**
 * 动作分解播放器。
 *
 * ## 它要解决的问题
 *
 * 上游动图是「定格 1 秒 → 连放 5 张 100ms」的 4fps 循环（见 lib/gifFrames.ts 顶部注释），
 * 用户看它只知道「大概是这样动」，但看不清关节角度、下放幅度、顶点停顿这些真正决定
 * 动作对不对的细节。数据集自带的 5～9 条分步说明又只是被动地堆在图下面，
 * 文字讲第 3 步时画面可能正停在定格帧上 —— 两者对不上，等于没有。
 *
 * ## 这里怎么解决
 *
 * 把「步骤」和「帧」显式绑起来：
 *   1. 步骤列表可点，点第 k 步画面直接跳到对应帧并**停住**，不再自己往下播；
 *   2. 播放时当前步骤自动高亮，用户能看见「文字在说什么、画面在做什么」；
 *   3. 慢放是真的慢放（自己控制时钟，不受 GIF 100ms 延时下限约束）；
 *   4. 可拖进度条逐帧检查。
 *
 * 三种播放模式各有用途，所以都留着：整段循环看节奏、单步看细节、慢放看发力。
 *
 * ## 降级
 *
 * 解码失败（文件损坏、格式异常）或用户开了「减少动态效果」时，回落到静态缩略图 +
 * 纯文字步骤。宁可少一个功能，也不能留一块空白或者让动效惹人烦。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
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

/** 慢放档位。1x 是素材原始速度，往下降是为了看清发力过程 */
const SPEEDS = [0.25, 0.5, 1] as const;
type Speed = (typeof SPEEDS)[number];

type Status = 'loading' | 'ready' | 'failed';

/** 尊重系统的「减少动态效果」偏好：开了就不自动播放，只给静态图 + 手动步进 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function ExercisePlayer({ gifSrc, thumbSrc, alt, steps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<Status>(gifSrc ? 'loading' : 'failed');
  const [gif, setGif] = useState<DecodedGif | null>(null);
  /** 当前画到第几帧 */
  const [frame, setFrame] = useState(0);
  /** 是否在自动播放 */
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(0.5);
  /** 当前选中的步骤。null = 用户没在跟步骤，自由播放 */
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const reducedMotion = useMemo(prefersReducedMotion, []);

  /**
   * 运动帧的下标序列。
   *
   * 数据集每个循环里夹着 1～3 处长定格（1000ms / 500ms），原速播过去就是
   * 「动一下卡一下」。这里把它们剔掉，只留连续运动的帧 ——
   * 播放、步骤映射、进度条都基于这个序列，所以看到的动作是连贯的。
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
        // 从运动段开头起播，别让用户先瞪着 1 秒定格
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

  // ---------- 播放时钟 ----------
  useEffect(() => {
    if (!playing || !gif || status !== 'ready') return;

    // 用 setTimeout 递归而不是 setInterval：
    // 每帧时长不同，且慢放倍率会变，间隔必须每帧重算。
    let timer: number;
    const tick = () => {
      const current = gif.frames[frame];
      // 每帧显示时长 = 原始时长 / 倍率。0.25x 时 100ms 的帧会显示 400ms。
      // 这就是原生 GIF 做不到的地方 —— 浏览器不允许延时低于 100ms，反向拉长才可行。
      const waitMs = current.durationMs / speed;

      timer = window.setTimeout(() => {
        setFrame((f) => {
          // 在**运动帧序列**里前进一格，而不是帧号 +1。
          // 这样中间的长定格帧会被直接跳过，播放是连贯的 ——
          // 那几处定格正是「动一下卡一下」的来源。
          const at = motion.indexOf(f);
          if (at < 0) return motion[0]; // 当前帧不在序列里（用户手动拖到了定格帧）
          return motion[(at + 1) % motion.length];
        });
      }, waitMs);
    };
    tick();

    return () => window.clearTimeout(timer);
  }, [playing, gif, frame, speed, status, motion]);

  // 素材就绪后，默认开播；用户开了减少动态效果就不自动播
  useEffect(() => {
    if (status === 'ready' && !reducedMotion) setPlaying(true);
  }, [status, reducedMotion]);

  // ---------- 操作 ----------
  const stopAuto = useCallback(() => setPlaying(false), []);

  const step = useCallback(
    (delta: number) => {
      if (!gif) return;
      stopAuto();
      setActiveStep(null);
      setFrame((f) => {
        // 在运动帧序列里前后移动，跳过定格帧 ——
        // 否则「下一帧」有 1/3 的概率停在几乎一样的静止画面上，
        // 用户会以为按钮没生效。
        const at = motion.indexOf(f);
        const from = at < 0 ? 0 : at;
        const next = from + delta;
        // 两端不循环：单步检查时绕回去会让人失去位置感
        return motion[Math.max(0, Math.min(motion.length - 1, next))];
      });
    },
    [gif, motion, stopAuto],
  );

  /** 点步骤：跳到该步骤对应的帧并停住，同时把它标为当前步骤 */
  const goToStep = useCallback(
    (index: number) => {
      if (!gif) return;
      stopAuto();
      setActiveStep(index);
      setFrame(stepToFrame(index, steps.length, motion));
    },
    [gif, steps.length, motion, stopAuto],
  );

  const togglePlay = useCallback(() => {
    // 手动播放时取消步骤跟随，否则步骤高亮会和画面打架
    if (!playing) setActiveStep(null);
    setPlaying((p) => !p);
  }, [playing]);

  const restart = useCallback(() => {
    if (!gif) return;
    setActiveStep(null);
    setFrame(motion[0]);
    setPlaying(true);
  }, [gif, motion]);

  /** 播放时反向高亮步骤：画面走到哪一帧，就点亮对应的那条说明 */
  useEffect(() => {
    if (!playing || !gif || steps.length === 0) return;
    // 找出「该帧所对应的步骤」：对每条步骤算出它的目标帧，取不超过当前帧的最大者
    let matched = 0;
    for (let i = 0; i < steps.length; i += 1) {
      if (stepToFrame(i, steps.length, motion) <= frame) matched = i;
    }
    setActiveStep(matched);
  }, [playing, frame, gif, steps.length, motion]);

  const onScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stopAuto();
      setActiveStep(null);
      // 滑块给的是运动帧序列里的位置，映射回真实帧号
      setFrame(motion[Number(e.target.value)] ?? motion[0]);
    },
    [stopAuto, motion],
  );

  /** 当前帧在运动帧序列里的位置。用户看到的「第几帧」以序列为准 ——
   *  定格帧不算进度，否则滑块会在原地停两下。 */
  const motionPos = Math.max(0, motion.indexOf(frame));
  const progress = motion.length > 1 ? (motionPos / (motion.length - 1)) * 100 : 100;
  const showCanvas = status === 'ready' && gif;

  return (
    <div className="player">
      {/* 画面区。canvas 保持 1:1 逻辑尺寸，由 CSS 缩放，
          这样高清屏上不会因为放大而发虚 —— 源图只有 180×180。 */}
      <div className="player-stage">
        {showCanvas ? (
          <canvas
            ref={canvasRef}
            className="player-canvas"
            role="img"
            aria-label={`${alt} 动作分解演示，第 ${motionPos + 1} 帧，共 ${motion.length} 帧`}
          />
        ) : thumbSrc ? (
          /* 解码失败或无动图素材：退回静态图。
             不留空白框，也不显示报错 —— 用户不关心技术原因，只想看到动作。 */
          <img className="player-canvas player-static" src={thumbSrc} alt={`${alt} 动作示意`} />
        ) : (
          <div className="player-canvas player-none">暂无演示</div>
        )}

        {status === 'loading' && <div className="player-loading">正在解码演示…</div>}

        {showCanvas && (
          /* 帧号以运动帧序列为准（不含定格帧），和进度条、步骤映射同一套口径。
             分母用运动帧数而不是总帧数，避免出现「共 24 帧但滑块只走 20 格」的困惑。 */
          <div className="player-frame-badge">
            {motionPos + 1} / {motion.length}
          </div>
        )}
      </div>

      {/* 控制条 */}
      {showCanvas && (
        <div className="player-controls">
          <div className="player-buttons">
            <button
              className="player-btn"
              onClick={restart}
              aria-label="重新播放"
              title="重新播放"
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="player-btn"
              onClick={() => step(-1)}
              disabled={motionPos <= 0}
              aria-label="上一帧"
              title="上一帧"
            >
              <SkipBack size={15} />
            </button>
            <button
              className="player-btn player-btn-main"
              onClick={togglePlay}
              aria-label={playing ? '暂停' : '播放'}
              title={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              className="player-btn"
              onClick={() => step(1)}
              disabled={motionPos >= motion.length - 1}
              aria-label="下一帧"
              title="下一帧"
            >
              <SkipForward size={15} />
            </button>
          </div>

          {/* 慢放档位。这是整个播放器存在的主要理由 —— 原速只有 4fps 且
              一半时间是静止，不慢放根本看不清关节怎么动。 */}
          <div className="player-speeds" role="group" aria-label="播放速度">
            <Gauge size={13} className="player-speed-icon" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`player-speed ${speed === s ? 'on' : ''}`}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 进度条：逐帧拖拽。定格帧不在序列里，所以每一格都对应一个真实的动作画面，
          拖动时不会出现「拖了两格画面没变」的错觉 */}
      {showCanvas && (
        <div className="player-scrub">
          <input
            type="range"
            min={0}
            max={motion.length - 1}
            value={motionPos}
            onChange={onScrub}
            aria-label="逐帧查看"
            className="player-range"
          />
          <div className="player-progress" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* 分步说明。点一条就跳到对应画面 —— 这是「看懂动作」的关键，
          文字和画面终于对上了。 */}
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
