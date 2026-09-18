/// <reference types="vite/client" />

/**
 * omggif 是纯 JS 库，npm 包里没有附带 .d.ts。
 * 这里只声明本项目实际用到的那部分 API（GifReader），
 * 不追求覆盖它的编码器（GifWriter）——用不到就不声明，
 * 免得留下没人验证过的类型。
 */
declare module 'omggif' {
  /** 单帧的元信息，字段名与 GIF 规范里的术语对应 */
  export interface GifFrameInfo {
    /** 帧左上角在逻辑画布中的 x */
    x: number;
    /** 帧左上角在逻辑画布中的 y */
    y: number;
    /** 帧宽度 */
    width: number;
    /** 帧高度 */
    height: number;
    /** 是否启用透明色 */
    has_local_palette: boolean;
    /** 调色板偏移（有局部调色板时才有意义） */
    palette_offset: number | null;
    /** 调色板大小 */
    palette_size: number | null;
    /** 帧间处置方式：0/1 保留、2 还原背景、3 还原之前 */
    disposal: number;
    /** 是否隔行扫描 */
    interlaced: boolean;
    /** 原始延时值，单位 1/100 秒（0 表示文件未指定） */
    delay: number;
    /** 透明色索引，null 表示无透明 */
    transparent_index: number | null;
  }

  export class GifReader {
    constructor(buf: Uint8Array);
    /** 逻辑画布宽度 */
    readonly width: number;
    /** 逻辑画布高度 */
    readonly height: number;
    /** 帧总数 */
    numFrames(): number;
    /** 取第 i 帧的元信息 */
    frameInfo(i: number): GifFrameInfo;
    /**
     * 把第 i 帧解码成 RGBA 写入 buf。
     * buf 长度需为 width * height * 4，且是**整幅**画布（不是帧的子矩形）。
     */
    decodeAndBlitFrameRGBA(i: number, buf: Uint8Array | Uint8ClampedArray): void;
  }
}
