# Strong — 训练计划

中文健身训练器。按身高体重与场地自动排课，内置 **1318 个动作**的步骤说明与动画演示。

React 19 + Vite 6 的纯前端 SPA，数据与素材全部在本地，**可离线使用**（PWA）。

## 快速开始

```bash
npm install
npm run dev            # 开发服务器
```

首次 clone 后**必须**补一步媒体素材，否则动作演示图全是空的：

```bash
npm run media:fetch    # 下载 1324 个 GIF + 缩略图，约 138MB
```

> 为什么不在仓库里：媒体是二进制文件，一旦提交就永久留在 git 历史里，且可以从数据集
> 重新生成。`public/media/` 已加进 `.gitignore`。

媒体脚本支持**断点续传**，中断后重跑即可，只会补缺失的文件。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览生产构建（默认 4173，审计脚本用 4199） |
| `npm run media:fetch` | 下载动作演示媒体（**首次必跑**） |
| `npm run dataset:fetch` | 下载数据集原始清单（仅数据集更新时需要） |
| `npm run catalog:build` | 从数据集重新生成 `src/lib/catalog.json` |

日常开发**不需要**跑 `dataset:fetch` / `catalog:build`：生成产物
`src/lib/catalog.json` 已入库。

## 数据与素材

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 动作目录 | `src/lib/catalog.json` | 1318 条，仅中文（源数据 10 语种会到 17MB） |
| 演示 GIF | `public/media/gif/` | 1324 个，**不入库** |
| 缩略图 | `public/media/thumb/` | 1324 个，**不入库** |

数据来源：[Devillmy/exercises-dataset-zh](https://github.com/Devillmy/exercises-dataset-zh)
（MIT，媒体版权归 Gym visual）。页脚常驻 CC BY-SA 4.0 署名链接。

## 验证

审计与端到端脚本都在仓库根目录。跑之前先起预览服务器：

```bash
npm run preview -- --port 4199 --strictPort    # 一个终端
node audit-product.cjs                          # 另一个终端
```

| 脚本 | 作用 |
| --- | --- |
| `audit-product.cjs` | 产品级审计（落点、输入形态、焦点、SVG、PWA 等），输出实测值 |
| `e2e-trend.cjs` | 力量趋势图（取值口径、坐标映射、边界） |
| `e2e-landing.cjs` | 首次落点优先级 + 存储坏数据健壮性 |
| `e2e-pwa.cjs` | PWA（manifest / SW / 离线缓存） |
| `e2e-regression.cjs` / `e2e-wizard.cjs` / `e2e-optimize.cjs` | 主线回归 |
| `verify-fix.cjs` / `verify-media.cjs` | 历史修复复核、媒体完整性 |

这些脚本的**断言**是产品契约（取值口径、坐标映射、落点优先级），改了功能要同步改断言，
而不是改断言迁就实现。

## 架构要点

- **状态**：`usePersistentState` 统一走 localStorage，带 `validate` 参数——
  存储里若是坏数据（`null` / 类型不符）会回落到初始值，而不是让页面白屏。
- **路由**：hash 路由（`#browse` `#plan` `#build` `#timer` `#history`）。
  首次落点按「用户此刻的处境」推断：深链 > 进行中训练 > 已有编排 > 空手→计划页。
- **PWA**：`public/sw.js` 按资源性质分缓存策略——导航网络优先（保证发版拿到新版），
  `assets/` 与 `media/` 缓存优先。**install 阶段会主动抓首屏构建产物**，
  因为 SW 注册晚于首屏请求，只靠 fetch 事件首访什么都不会入缓存。
  所有路径从 `registration.scope` 推导 base，因此本地（`/`）与 Pages 子路径
  （`/<仓库>/`）都能正确缓存——改这个文件时不要引入裸的 `/assets/` 判定。

## 部署到 GitHub Pages

已配好 Actions 工作流 `.github/workflows/deploy-pages.yml`，推到 `master`/`main` 即自动发布。

**一次性设置**（只做一次）：仓库 `Settings → Pages → Build and deployment → Source`
选 **GitHub Actions**。选错了不会有任何报错，只是 Pages 一直不更新。

**访问地址**：`https://<你的用户名>.github.io/<仓库名>/`

推完之后拿链接的最快方式：仓库首页右侧 **Deployments**（或 Actions 里那次运行的
`deploy` job）会直接显示 `page_url`。

### 部署路径这件事，别踩

GitHub Pages 的**项目站点**跑在子路径 `/<仓库名>/` 下，而 Vite 默认假设站点在根 `/`。
若不管，产物里的 `<script src="/assets/index-xxx.js">` 会指向
`https://<用户>.github.io/assets/...` ——那是域名根，必然 404，打开就是**白屏**。

所以工作流会注入 `BASE_PATH=/<仓库名>/`，`vite.config.ts` 读它作为 `base`。
本地不设这个变量，走 `/`，两边互不影响。

**所有站内路径都必须从 base 派生**，写死 `/` 的地方在子路径下全都会坏。
已处理的位置（改动前请先读这几处的注释）：

| 位置 | 处理方式 |
| --- | --- |
| `vite.config.ts` | `base` 读 `BASE_PATH` |
| `src/lib/store.ts` | 图片地址用 `import.meta.env.BASE_URL` 拼接 |
| `src/main.tsx` | SW 注册用 `import.meta.env.BASE_URL` |
| `public/sw.js` | 从 `registration.scope` 推导 base，缓存判定按前缀 |
| `index.html` | `icon.svg` / `manifest.json` 用相对路径 `./` |
| `public/manifest.json` | `start_url` / `scope` / 图标用相对路径 `./` |

其中 **`store.ts` 与 `sw.js` 最隐蔽**：前者漏改的表现是「页面能开、1324 张动作图全裂」，
后者漏改的表现是「只有离线能力失效，在线完全正常」——都只有在生产环境才暴露。

### 为什么用 Actions 而不是推 `dist/` 分支

动作素材 138MB 不入库，构建前必须现拉（工作流里的 `dataset:fetch` + `media:fetch`）。
走 Actions 能保留这份「仓库干净、构建自足」的性质；推 `dist/` 会把 138MB 二进制
灌进 git 历史，且每次发版都存一份。

发布前工作流会自检：资源引用是否都带 base 前缀、媒体数量是否到位、SW 是否已适配子路径。
这些是「页面能打开但实际是坏的」的典型症状，挡在部署前比等用户发现白屏好。

## 已知约束

- **动作图必须放在白色「灯箱」里，不能反色。** 素材是 180×180 的**白底**解剖线稿，
  带红色肌肉高亮。深色主题下试过两条捷径都不行：
  - `mix-blend-mode: multiply` 是给浅色底用的，放到深底会把整张图**乘成接近全黑**；
  - `filter: invert()` 能把白底翻成深底，但红色高亮变青、肤色失真，
    而解剖图的信息恰恰靠颜色表达。

  所以 `--media-bg` 保持**纯白**，和 GIF 自带白底无缝拼上，边界靠 `--media-border`
  交代。改主题时不要动这两个变量。

- 深色是当前唯一主题（`color-scheme: dark`），暂未做浅色适配。

产品评审结论与待办见上级目录的 `产品评审报告.md`。
