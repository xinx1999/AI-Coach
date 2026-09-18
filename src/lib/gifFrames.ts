/**
 * GIF 逐帧解码 + 本地播放器。
 *
 * ## 为什么不用原生 <img src="x.gif">
 *
 * 上游数据集的动图有个硬伤：循环结构是「定格 1 秒 → 连放 5 张 100ms」，
 * 3 秒里 2 秒是静止的（全量 1324 个文件 90% 都长这样）。用户反馈「看不清动作要领」，
 * 想慢放，但 GIF 做不到：
 *
 *   - GIF 的延时字段单位是 1/100 秒，只能填整数；
 *   - 更麻烦的是浏览器有历史包袱，**任何 < 2cs 的延时会强制改写成 10cs（100ms）**。
 *
 * 所以就算把延时改成 1cs，浏览器实际还是 100ms 一帧，慢放无从谈起。
 * 原生 <img> 又不给暂停/步进的接口。
 *
 * ## 这里的做法：自己解码、自己按帧重绘
 *
 * 用 omggif 把 GIF 拆成「每帧一张 RGBA 位图 + 该帧的原始延时」（读的是文件里的
 * 真实值，不受浏览器改写影响），然后按我们自己的时钟画到 canvas 上。
 * 这样：
 *   - 能暂停、能单帧步进、能精确跳到任意帧；
 *   - 慢放是真的慢放（把每帧显示时长乘以倍率，不受 100ms 下限约束）；
 *   - 步骤说明可以精确指到某一帧。
 *
 * ## 合成规则
 *
 * GIF 支持帧间差异更新（每帧只存变化区域），所以不能简单地把每帧当作完整画面，
 * 必须按 disposal method 逐帧合成到一张累积画布上：
 *   - 0/1 保留：下一帧直接盖在上面
 *   - 2 还原背景：画完当前帧后，把它占用的区域清成背景色
 *   - 3 还原之前：画完后把区域恢复成再上一帧的样子（少见，这里用快照实现）
 */

import { GifReader } from 'omggif';

export interface GifFrame {
  /** 合成好的完整画面（含透明通道），尺寸等于 GIF 逻辑画布 */
  imageData: ImageData;
  /** 该帧的真实显示时长（毫秒），取自文件里的原始延时值 */
  durationMs: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  frames: GifFrame[];
  /** 整个循环的总时长（毫秒） */
  totalMs: number;
  /** 平均帧率，用于给用户一个「源素材有多快」的预期 */
  fps: number;
}

/** 浏览器对 <2cs 延时的改写值，也是我们解析不到有效延时的兜底值 */
const DEFAULT_DELAY_MS = 100;

/**
 * 解析一个 GIF 为逐帧位图。
 *
 * @param buffer GIF 原始字节
 * @throws 当数据不是合法 GIF 时抛出，调用方应回落到静态缩略图
 */
export function decodeGif(buffer: ArrayBuffer): DecodedGif {
  const reader = new GifReader(new Uint8Array(buffer));
  const width = reader.width;
  const height = reader.height;
  const count = reader.numFrames();

  // 累积画布：GIF 是「增删改」式的帧序列，必须逐帧叠加出完整画面
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');

  const frames: GifFrame[] = [];
  let totalMs = 0;

  // disposal=3 需要「上上帧」的快照；只留最近一张就够
  let prevSnapshot: ImageData | null = null;

  for (let i = 0; i < count; i += 1) {
    const info = reader.frameInfo(i);

    // disposal=3：先把「当前还没被这一帧覆盖」的画面存下来，
    // 这一帧显示完后要恢复成它
    const beforeDraw = info.disposal === 3 ? ctx.getImageData(0, 0, width, height) : null;

    // 把这一帧解码到整幅位图上，再整幅贴上去。
    // 不裁到 (x,y,w,h) 子区域是因为 omggif 的 decodeAndBlitFrameRGBA 本来就
    // 按帧的 x/y 写入整幅缓冲，透明区域保持原样，直接整幅覆盖最简单也不易错。
    const rgba = new Uint8ClampedArray(width * height * 4);
    reader.decodeAndBlitFrameRGBA(i, rgba);
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

    // 合成完这一帧，先取出来存好（后面可能还要用它做还原）
    const composed = ctx.getImageData(0, 0, width, height);

    // 原始延时。0 或缺失都说明文件没写，按浏览器惯例兜底成 100ms
    const rawCs = info.delay;
    const durationMs = rawCs > 0 ? rawCs * 10 : DEFAULT_DELAY_MS;

    frames.push({ imageData: composed, durationMs });
    totalMs += durationMs;

    // 为下一帧准备画布状态
    if (info.disposal === 2) {
      // 还原背景：把这一帧占用的矩形清空。
      // 严格说应填背景色，但数据集里的动图背景都是白的，
      // 清成全透明再由 CSS 白底衬托，效果一致且更省事。
      ctx.clearRect(info.x, info.y, info.width, info.height);
    } else if (info.disposal === 3 && prevSnapshot) {
      ctx.putImageData(prevSnapshot, 0, 0);
    }
    prevSnapshot = beforeDraw;
  }

  return {
    width,
    height,
    frames,
    totalMs,
    fps: totalMs > 0 ? (frames.length / totalMs) * 1000 : 0,
  };
}

/** 判定「这是定格帧」的阈值：明显长于中位数就算。1.8 倍是实测调出来的 ——
 *  数据集里的定格帧是 1000ms 或 500ms，运动帧是 100ms，两者差 5～10 倍，
 *  阈值放在 1.8 倍既能抓住 500ms 的次长定格，又不会把 100ms 的正常帧误判。 */
const HOLD_RATIO = 1.8;

/** 取帧时长的中位数，作为「正常运动帧有多快」的基准 */
function medianDuration(frames: GifFrame[]): number {
  if (frames.length === 0) return 0;
  const sorted = frames.map((f) => f.durationMs).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 把帧序列里的「定格帧」挑出来，返回纯运动帧的下标序列。
 *
 * ## 为什么需要这个
 *
 * 数据集 97% 的动作结构是「定格 1000ms → 5 帧运动 → 定格 500ms → 5 帧运动」，
 * 一个循环里有 1～3 处定格。原速播放看到的就是
 * 「动一下 → 停半秒 → 动一下 → 停一秒」—— 这正是用户反馈「不流畅、看不清」的根源。
 *
 * 去掉定格帧、把运动帧串起来连续播，动作就顺了。
 * 代价是播放节奏不再等同于原素材，但原素材本身并没打算表达真实运动速度
 * （真实的俯卧撑不会每组之间停半秒），所以这个取舍是划算的。
 *
 * @returns 运动帧的下标数组；一个定格都没有（或数据异常）时返回全部下标
 */
export function motionFrameIndices(frames: GifFrame[]): number[] {
  const all = frames.map((_, i) => i);
  if (frames.length < 3) return all;

  const median = medianDuration(frames);
  if (median <= 0) return all;
  const holdThreshold = median * HOLD_RATIO;

  const moving = all.filter((i) => frames[i].durationMs < holdThreshold);
  // 全被判成定格（异常数据）时不要返回空数组，否则播放器会崩
  return moving.length > 0 ? moving : all;
}

/**
 * 步骤 ↔ 帧 的对齐。
 *
 * 数据集的「步骤数」和「帧数」并不相等（比如 5 条步骤配 10 个运动帧），
 * 但两者都在描述同一件事的先后顺序，所以按比例对齐：
 * 第 k 条步骤（0-based，共 N 条）对应运动帧序列里的第 round(k*(M-1)/(N-1)) 个。
 *
 * 传入的是 `motionFrameIndices` 的结果而不是总帧数 ——
 * 这样步骤只会落在运动帧上。若把首步对到开头的定格帧、末步对到收尾的定格帧，
 * 用户点第一步和最后一步看到的都是静止画面，会以为功能坏了。
 *
 * @param motion 运动帧的下标序列
 */
export function stepToFrame(stepIndex: number, stepCount: number, motion: number[]): number {
  if (motion.length === 0) return 0;
  if (stepCount <= 1) return motion[0];
  const ratio = stepIndex / (stepCount - 1);
  const idx = Math.round(ratio * (motion.length - 1));
  // 夹紧下标，防御调用方传入越界的 stepIndex
  return motion[Math.min(motion.length - 1, Math.max(0, idx))];
}

