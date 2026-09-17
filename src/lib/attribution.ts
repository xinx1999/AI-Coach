// 动作素材署名信息。
//
// 数据与媒体来自 Devillmy/exercises-dataset-zh：
//   - 数据集结构、说明文案、中文名翻译 → MIT License
//   - 动作演示 GIF 与缩略图 → © Gym visual，授权以 180×180 分辨率分发
//
// Gym visual 的条款明确要求保留署名，且「二次使用受其条款约束」，
// 所以这行署名必须展示在界面上，不能只写在 README 里。

export const ASSET_ATTRIBUTION = {
  datasetName: 'exercises-dataset-zh',
  datasetUrl: 'https://github.com/Devillmy/exercises-dataset-zh',
  datasetLicense: 'MIT',
  mediaOwner: 'Gym visual',
  mediaUrl: 'https://gymvisual.com/',
  mediaNote: '经授权以 180×180 分辨率分发',
} as const;

/** 一行式署名文本，用于页脚 */
export const ATTRIBUTION_LINE =
  `动作演示媒体 © ${ASSET_ATTRIBUTION.mediaOwner}（${ASSET_ATTRIBUTION.mediaNote}），` +
  `数据来自 ${ASSET_ATTRIBUTION.datasetName}。`;
