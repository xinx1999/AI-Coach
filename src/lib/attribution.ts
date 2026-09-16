// 动作素材署名信息（CC BY-SA 4.0 要求保留）
//
// 302 个动作的图片全部来自 @bryllim/workout-guide，署名与许可完全一致，
// 因此这里只维护一份公共常量，而不是跟着每个动作走一份副本
// （后者会在打包产物里重复上千次，把小体积的索引撑大到数百 KB）。
//
// 原始姿态图来自 Everkinetic（CC BY-SA 4.0），
// 由 Bryl Lim 在此基础上补齐动作、动画帧与结构化元数据。

export const ASSET_ATTRIBUTION = {
  creator: 'Bryl Lim',
  creatorUrl: 'https://bryllim.com',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  sourceName: 'Everkinetic',
  sourceUrl: 'https://github.com/everkinetic/data',
  changes: '栅格化为 512 × 512 透明画布并重新着色为单色。',
} as const;

/** 一行式署名文本，用于页脚或关于页 */
export const ATTRIBUTION_LINE =
  `动作插画 © ${ASSET_ATTRIBUTION.creator}（${ASSET_ATTRIBUTION.license}），` +
  `衍生自 ${ASSET_ATTRIBUTION.sourceName}。`;
