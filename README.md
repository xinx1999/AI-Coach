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
| `e2e-responsive.cjs` | **三端适配**（7 档宽度 × 5 个页面：导航可达性、无横向溢出） |
| `e2e-player.cjs` | **动作演示区**（读 canvas 像素验证解码、零交互、无定格、放慢 2 倍） |
| `e2e-equipment.cjs` / `e2e-plan-loc.cjs` | 器械筛选、场地标签 |
| `analyze-gif.cjs` / `analyze-gif-stats.cjs` | GIF 帧结构与节奏分析（查证「动图为什么看着卡」） |
| `verify-fix.cjs` / `verify-media.cjs` | 历史修复复核、媒体完整性 |
| `verify-live.cjs` | **线上站点**验证（真实浏览器跑 Pages 地址，不需要本地服务器） |

`e2e-responsive.cjs` 跑在 dev server（5173）上，其余大多数脚本跑在 preview（4199）上。
`verify-live.cjs` 直接把线上地址写死在里面，改域名时记得同步。

脚本共用一个引导模块 `e2e-setup.cjs` 来定位 playwright 和 chromium。
**不要在各个脚本里各自 `require('playwright-core')` 和硬编码浏览器路径** ——
playwright 换版本时目录名和文件名都会变（`chrome-win/headless_shell.exe` 曾变成
`chrome-headless-shell-win64/chrome-headless-shell.exe`），复制多份就意味着一处失效、
多处报错，而且报的是「找不到模块」这种和真实原因无关的错。
浏览器路径由该模块扫描 `ms-playwright/` 自动发现，找不到时会给出安装指令。

**三端适配既要在本地跑，也要在线上跑一遍**，因为本地 dev 不带 base 前缀，
测不出子路径下的问题：

```bash
npm run dev                                                    # 另开终端
node e2e-responsive.cjs                                        # 本地（默认 5173）
BASE=https://<用户>.github.io/<仓库> node e2e-responsive.cjs    # 线上
```

这些脚本的**断言**是产品契约（取值口径、坐标映射、落点优先级、导航可达性），改了功能要同步改断言，
而不是改断言迁就实现。

## 响应式（三端适配）

断点按**可用宽度**切，不按设备型号。定义在 `src/styles/global.css` 末尾：

| 档位 | 宽度 | 行为 |
| --- | --- | --- |
| 桌面 | ≥ 1025px | 完整布局，内容居中于 940px（动作库 1180px） |
| 平板 | 641–1024px | 表单并排、动作网格降列数、内边距收窄 |
| 手机 | ≤ 640px | 单列堆叠，**导航只留图标**，弹窗改底部抽屉 |
| 极小屏 | ≤ 380px | 进一步压缩顶栏与网格 |
| 横屏矮屏 | 高度 ≤ 520px | 按高度收窄，优先保证垂直空间 |

几个容易踩的点：

- **导航文字必须包在 `.nav-btn-label` span 里。** 窄屏靠 `display:none` 把它藏起来只留图标，
  五个入口才排得下。写裸文本节点（`{icon} {label}`）的话那条 CSS 选不中，
  按钮会被撑宽、最后一个被推出视口——而且 `document.scrollWidth` 检测不到，
  因为溢出发生在 `.app-nav` 内部。
- **`.app-nav` 不要用 `overflow-x: auto`。** 触屏上横向滚动条几乎不会被发现，
  用户只会觉得「有两个按钮不见了」。正确做法是允许收缩 + 隐藏文字。
- **`.app-title` 要 `flex-shrink: 0`，`.app-nav` 要 `min-width: 0`。**
  flex 子项默认 `min-width: auto`，不加就压不下去，内容会反向溢出到父容器外，
  于是标题（z-index 更高）盖住按钮，表现为「前两个按钮点不动」。
- **`100dvh` 而不是 `100vh`。** 手机浏览器地址栏收起前的 `100vh` 会把底部推出可视区。
- **`viewport-fit=cover` 已开**，所以底部/左右要补 `env(safe-area-inset-*)`，
  否则 iPhone 的横条和刘海会压住内容。

**改了布局请跑 `node e2e-responsive.cjs`**（先起 5173）。它断言的是契约而不是像素值，
所以调整内边距不会误报；但能挡住「有按钮跑到视口外」这类真问题。

## 动作演示：为什么不用原生 `<img src="x.gif">`

上游数据集的动图**本身就不顺**，这是实测出来的事实，不是本项目的 bug：

| 指标 | 实测值（全量 1324 个） |
| --- | --- |
| 有效帧率 | 中位数 **4.00 fps**，范围 1.71–6.00 |
| 单循环帧数 | 12 帧 / 3.0 秒（最常见） |
| 内嵌节奏 | `1000ms 定格 → 5×100ms 运动`，一个循环里 1–3 处定格 |
| 静止占比 | 约 **67%** |

用 `analyze-gif-stats.cjs` 可以复核这些数字。原速播出来就是「动一下、停半秒、动一下」，
用户反馈的「看不清动作要领」根源在此。

所以演示区换成了自研播放器（`src/components/ExercisePlayer.tsx`），要点：

- **自己解码、自己按帧重绘。** 用 `omggif` 把 GIF 拆成「每帧 RGBA + 原始延时」，
  按自己的时钟画到 canvas。这么做是为了绕开 GIF 的两个硬限制：
  延时字段单位是 1/100 秒只能填整数，且**浏览器会把任何 <2cs 的延时强制改写成 10cs（100ms）**——
  也就是说原生 `<img>` 根本无法按真实时长播放，也拿不到逐帧的接口。
- **先剔掉定格帧，再整体放慢 2 倍。** 顺序不能反 —— `motionFrameIndices()` 按
  「明显长于中位数」识别定格帧并排除，然后才把每个运动帧的时长乘以 `SLOWDOWN = 2`
  （100ms → 200ms）。反过来的话定格帧也会被一起拉长，一个 1 秒的定格会变成 2 秒，
  比不放慢更难受。
  放慢的代价是节奏不再等同于原素材 —— 但原素材本来也没表达真实运动速度
  （真实的俯卧撑不会每组之间停半秒），这个取舍是划算的。
- **降级**：解码失败回落到静态缩略图；用户开了 `prefers-reduced-motion` 则不自动播放。

### 为什么演示区是零交互的

前后做了三版，一路做减法：

1. **带暂停 / 逐帧 / 慢放 / 进度条 / 速度档的完整播放器** —— 否掉了。
   用户原话「不太想要暂停 / 逐帧 / 慢放、控制条」。需求是「打开就看到动作在动」，
   不是「能操控」，一排控件占掉画面下方的空间，是负担而不是功能。
2. **自动循环 + 可点步骤列表**（点第 k 步跳画面 + 反向高亮）—— 也否掉了。
   用户原话「步骤 ↔ 画面对齐也不要了」。点击跳帧打断了连续观察，
   而且文字和帧本来就不是精确对应的，硬绑反而让人分心。
3. 现在这样：**动图自己慢慢循环，下面单纯列出步骤文字。零交互。**

所以演示区里没有任何可点元素：没有控制条，步骤列表也退化成纯文字（`<li>` 而非按钮）。
唯一还保留的机制是「剔除定格帧 + 放慢」，它们在代码里，不占用界面。

**改播放器请跑 `node e2e-player.cjs`**（先起 4199）。零交互之后，
所有「点一下看看」的测法都失效了，剩下两个必须守住的契约：

- **零交互** —— 断言 `.player` 内部的可点元素数为 0。这条看着像废话，
  其实是三次做减法攒下来的契约：以后谁再加回一个按钮，这里会失败，
  而不是等用户抱怨。
- **定格帧剔除 + 放慢 2 倍** —— 在**页面内**用 `requestAnimationFrame` 观测画面变化，
  `最长一次静止` 守着前者、`帧间隔中位数` 守着后者（期望 200ms）。

已实测两条都有牙（注入回归后确实失败）：

| 注入的回归 | 断言反应 |
| --- | --- |
| `SLOWDOWN = 1`（没放慢） | 帧间隔中位数 **109ms** → 失败 |
| `motionFrameIndices` 直接返回全部帧 | 最长一次静止 **1842ms** → 失败 |

⚠️ 这里有个**测法陷阱**值得记下：最初我在 Node 侧循环
`取指纹 → waitForTimeout(40)` 来量帧间隔，量出 47ms，看着像「根本没放慢」。
其实那是**测法错了**：每次取指纹都要走一遍 Playwright 跨进程协议，
单次往返远超 40ms，于是真正的采样间隔由协议开销决定，
算出来的「间隔」跟动画速度毫无关系。把观测放进页面内（rAF 与渲染同频、
时间戳同一个时钟）才量到干净的 200ms。**测不准时先怀疑测法，别急着改代码。**


## 动作提示：呼吸与常见错误

数据集这两块几乎是空的 —— 全量 1318 个动作里只有 **11%** 的步骤文本提到呼吸、
**0.8%** 提到注意事项。而这正是新手最容易做错的地方，所以由 `src/lib/coaching.ts` 生成：

- **呼吸节奏**不是拍脑袋编的，是从数据集**已有的** 291 句呼吸描述里反推的规律：
  发力（向心）呼气、回放（离心）吸气。已有的句子 100% 符合这条，
  所以生成文案的风格和数据集一致。计时类、拉伸类、有氧类另按各自项目惯例处理。
- **常见错误**按动作特征（器械、身体部位、计量方式）拼装，只给这个动作真正容易犯的三条。
- 生成内容必须和 `COACHING_DISCLAIMER` 免责说明一起出现 ——
  这是通用运动原则，不是针对个人身体状况的医嘱。

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

**一次性设置**（只做一次）：仓库 `Settings → Pages`，把 `Source` 选成 **GitHub Actions**。
直达地址 `https://github.com/<用户>/<仓库>/settings/pages`。

> 注意：`Build and deployment` 是旧版界面的小节标题，新版已删掉，左侧栏里**只有 `Pages`**。
> 另外新仓库的 Pages 默认未启用，此时 `actions/configure-pages` 会直接失败，
> 而日志不会提示「Pages 没开」——表现为构建的前几步全绿、只挂在 `Setup Pages`，
> 且 `deploy` 作业被 skipped。判断方法：`GET /repos/{owner}/{repo}` 看 `has_pages` 是否为 false。

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
