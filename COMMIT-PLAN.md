# 提交计划 — Strong Trainer

> 工作区状态：**962 项改动**（924 D / 21 M / 17 ??），基于 HEAD = `f3ee99d`。
> 目标：拆成 5 个语义独立、可单独回滚、每个都能通过测试的提交。

---

## 0. 先看结论：这次改动是一次「架构级迁移 + 体验补齐」

改动不是零散的修补，而是三条并行的线：

| 线 | 内容 | 规模 |
|---|---|---|
| **A. 素材与数据管线** | 906 个 `frame-N.svg` → 1324 个 GIF + 缩略图；`src/lib/guide/*.ts`（15 个硬编码文件）→ `catalog.json.steps`；动作数 302 → 1318 | 924 删除 + 新增脚本 |
| **B. 功能补齐** | 力量趋势图、智能落点、收藏、编排排序、PWA 离线 | 6 个组件 + 5 个 lib |
| **C. 体验重做** | 全局深色主题、详情弹窗布局重构 | `global.css` 2415 行 |

**关键判断：A 和 B 存在硬依赖**，不能颠倒顺序 —— 见 §2。

---

## 1. 提交前必须先做的两件事

### 1.1 素材不入库，但必须能被拉到

`public/media/`（1324 GIF + 1324 缩略图 = **138 MB**）已在 `.gitignore:34` 中显式忽略。这是**刻意决定**，不是遗漏：

- 二进制文件一旦提交就永久留在 git 历史里，无法真正删除；
- 它们是数据集的可再生产物，没必要让每次 clone 背 138 MB。

因此**不要**用 `git add -f` 强行加进来。取而代之的入库物是拉取脚本：

```bash
npm run dataset:fetch   # 拉 exercise 清单（17 MB，同样被忽略）
npm run media:fetch     # 拉 GIF + 缩略图，支持断点续传、只补缺失
```

`scripts/name_zh.json`（80 KB，1319 行）**要入库** —— 中文名映射需要可查证。

### 1.2 确认被忽略的一次性产物没混进来

以下 13 项被忽略，确认其中**没有**你希望入库的：

```
.poses/  dist/  node_modules/
e2e-optimize.cjs  e2e-redesign.cjs  e2e-regression.cjs  e2e-wizard.cjs
landing-plan.png  shot-wizard-form.png  shot-wizard.png
trainer-browse.png  trainer-build.png  trainer-history.png
trend-1rm.png  trend-page.png  trend-weight.png
scripts/exercises.json
```

⚠️ **`e2e-regression.cjs` 被忽略了，但它是长期回归网**（就是本次改主题后断言 `.detail-secondary` 的那个测试）。
`.gitignore` 里已经有 `!e2e-trend.cjs` / `!e2e-landing.cjs` / `!e2e-pwa.cjs` 三条例外，
**建议补上 `!e2e-regression.cjs`**（还有 `e2e-wizard.cjs` 如果也想留）。这是本次计划里唯一一处需要改 `.gitignore` 的地方。

---

## 2. 依赖链（决定提交顺序）

```
① 素材与数据管线迁移
     types.ts (+gif/+thumb/+steps)
     store.ts (+gifPath/+thumbPath)          ← 依赖 types
     catalog.json (302→1318 条)
         │
         ▼
② 功能补齐（趋势图 / 落点 / 收藏 / 排序 / PWA）
     store.ts (sessions 结构变更)             ← 依赖 ① 的新 types
     BrowseView / TimerView / PlanWizard ...
         │
         ▼
③ 深色主题 + 详情弹窗布局
     global.css + ExerciseDetail + GuidePanel  ← 只依赖 ② 的类名
```

**为什么 ① 必须最先**：`store.ts` 的 `gifPath()` / `thumbPath()` 读的是 `types.ts` 新加的 `gif`/`thumb` 字段，
而这些字段由 `catalog.json`（新数据管线产物）提供。反过来先提功能提交会得到一个引用不存在字段的中间态。

**为什么 ③ 必须最后**：`ExerciseDetail.tsx` 引入的 `.detail-heading` / `.detail-secondary` 是
`e2e-regression.cjs` 的断言目标；而该断言是本次主题改造时才改的。两者同属 ③，原子性最好。

---

## 3. 五个提交

### 提交 ① 素材与数据管线迁移　`refactor`

> 一句话：把动作素材从「302 个手绘 SVG」换成「1324 个 GIF」，把教程内容从「15 个硬编码 TS 文件」换成「catalog.json 结构化字段」。

**删除（924）**
```
src/lib/guide/*.ts              (15)   ← 硬编码教程内容
public/assets/*/frame-N.svg     (906)  ← 302 个动作 × 3 帧
```

**新增**
```
scripts/build-catalog.cjs        (190 行)
scripts/fetch-dataset.cjs        (56 行)
scripts/fetch-media.cjs          (116 行)
scripts/name_zh.json            (1319 行)  ← 入库
```

**修改**
```
src/lib/types.ts                 (+70/-…)  +gif +thumb +steps
src/lib/store.ts                 (+gifPath +thumbPath)
src/lib/catalog.json             (302 → 1318 条，单行 JSON)
src/lib/attribution.ts           (31 行)
package.json                     +catalog:build / dataset:fetch / media:fetch
```

**必须一并处理的连带修改**（否则留下坏引用）：
- `catalog:build` 原本指向不存在的 `scripts/build-catalog.mjs` → 已修为 `.cjs`
- 删除 `src/lib/guide/` 后必须确认无残留 import（已确认目录已不存在）

**验证**：`npm run media:fetch`（首次必需）→ `npm run build` → 浏览页 1318 条可渲染缩略图

---

### 提交 ② 功能补齐：趋势图 / 智能落点 / 收藏 / 排序 / PWA / 器械选择　`feat`

**新增**
```
src/components/StrengthTrend.tsx  (238 行)
public/sw.js                      (186 行)
public/manifest.json              (27 行)
public/icon.svg  public/icon-maskable.svg
e2e-trend.cjs    (223 行)   e2e-landing.cjs (163 行)   e2e-pwa.cjs (260 行)
e2e-equipment.cjs (器械选择，19 断言)   diag-loc-tag.cjs (场地标签三态)
shot-trend.cjs   shot-landing.cjs   verify-media.cjs   perf-check.cjs
README.md        (94 行)  ← 项目从零到一的文档
```

**修改**
```
src/App.tsx                      (+60)   挂载 StrengthTrend
src/components/HistoryView.tsx   (+16)   承载趋势图
src/components/BrowseView.tsx    (+379)  收藏筛选 + 缩略图 + 落点 + 器械筛选归一
src/components/TimerView.tsx     (+223)  活动会话 + 休息时长
src/components/BuildView.tsx     (+33)   上移/下移排序
src/components/PlanWizard.tsx    (+206)  智能落点 + 器械选择 + 场地标签三态
src/lib/store.ts                 (sessions / favorites 持久化 + 器械数据层)
src/lib/persist.ts  src/lib/planner.ts  (器械筛选 + 三级回退)
src/main.tsx                     (+19)   SW 注册
index.html                       (+11)   manifest / theme-color / PWA meta
```

**器械选择（本次新增能力）**：用户报「在家里生成的计划没有对应的器械」。
根因是 `location` 只是个二值 home/gym 标记，`pick()` 从不按器械过滤。
现在 `PlanInput` 多一个 `equipment` 字段，`planner.pick()` 三级回退
（先放宽器械、再放宽场地），并把放宽原因写进 `warnings`。
顺带修掉两个潜伏 bug：`band`/`resistance band` 同名「弹力带」重复出项
（导致筛选漏 7 个动作）、以及自重动作在健身房器械列表里完全缺失。

**注意**：`index.html` 和 `main.tsx` 的 PWA 接线放这里，但 `theme-color` 的**取值**在 ③ 才定稿为 `#131316`。
若严格原子化，可把 `index.html` 留到 ③；实践中一起提交更省事，代价是 ② 的 theme-color 暂时还是亮色值。

**验证**：`node e2e-trend.cjs && node e2e-landing.cjs && node e2e-pwa.cjs && node e2e-equipment.cjs`（35 + 21 + 40 + 19 断言）

---

### 提交 ③ 全局深色主题 + 动作详情弹窗布局重构　`style`

**核心文件**
```
src/styles/global.css            (2415 行改动)  ← 最大的单文件改动
src/components/ExerciseDetail.tsx (+197/-…)     ← 布局重构
src/components/GuidePanel.tsx     (+78/-…)      ← 删掉重复的 meta 行
index.html                        theme-color 定稿 #131316
public/manifest.json              background/theme → #131316
e2e-pwa.cjs / e2e-regression.cjs  断言同步更新
```

**主题层（`global.css` 的 `:root`，307 行含变量）**
```css
:root {
  color-scheme: dark;
  --bg: #131316;  --surface: #1C1C20;  --surface-2: #26262B;  --surface-3: #32323A;
  --border: #2E2E35;  --border-strong: #3D3D46;
  --text: #F2F2F5;  --text-muted: #A6A6B0;  --text-faint: #8A8A96;
  --accent: #F2762E;  --accent-hover: #FF8A47;
  --media-bg: #FFFFFF;  /* 白色「灯箱」，见下 */
  --glass: rgba(28, 28, 32, 0.86);
}
```
- 把硬编码的 `rgba(255,255,255,0.86)` 玻璃态收敛为 `var(--glass)`
- `--text-faint` 从 `#6E6E78` 提到 `#8A8A96`：WCAG 对比度 3.37:1 → **4.98:1**，过 AA
- 全盘变量已用脚本核算过对比度

**弹窗布局（`ExerciseDetail` + `GuidePanel`）** —— 修掉截图里那几个问题：
1. **标题重复**：删掉重复的英文名行 → 合并为 `.detail-heading`（中文名 + 英文名 baseline 同行）
2. **标签行重复**：`.guide-meta` 与 `.detail-attrs` 内容重复 → 删掉 `guide-meta` 整块，
   协同肌群降级为一行次要信息 `.detail-secondary`
3. **图太小**：源图 180×180 被塞进 ~340px 的 `aspect-ratio:1` 容器 →
   `.demo` 改为固定 `height: 236px` + flex 居中，去掉 `max-height`
4. **灰边**：图自身白底比灰框窄，两侧露灰柱 → `--media-bg: #FFFFFF` 纯白灯箱，与图白底无缝

> ⚠️ **灯箱是硬约束，不要试图「把图也变成深色」**：
> ① `mix-blend-mode: multiply` 是浅色底技巧，深色下会把人像压成近黑；
> ② `filter: invert(1)` 会把肌肉高亮的红色转成青色，破坏解剖语义。
> 结论：深色 UI 里素材必须以白底灯箱呈现。已写入 `README.md` 的「已知约束」。

**验证**：`node e2e-regression.cjs && node e2e-pwa.cjs && node audit-product.cjs`
（K2 应确认 `rgb(19,19,22)` 背景 / `rgb(242,242,245)` 文字）

---

### 提交 ④ 工程修复　`chore`

```
.gitignore        (+30)  截图前缀补全（trend-/landing-/trainer-）
                         + 三条 e2e 例外（建议再加 !e2e-regression.cjs）
                         + public/media/ 忽略说明
audit-product.cjs
verify-fix.cjs
```

`package.json` 的脚本修复已在 ① 中处理（它与 `catalog:build` 强相关）。

---

### 提交 ⑤ 文档：评审报告收口　`docs`

```
../产品评审报告.md    ← 注意在仓库外（D:\work\AI\strong\ 下），不入本次仓库
```
- P1-2 / P2-1 / P2-5 标 ✅
- P2-3 重写为 ✅（深色主题）
- 新增「动画详情弹窗的布局修正」小节
- 补第三条测试陷阱
- 修正重复的小节编号（两个「七」→ 七 / 八）

> 该文件不在 `trainer/` 仓库内。若它也纳管，需单独处理。

---

## 4. 唯一需要 `git add -p` 的文件

`src/styles/global.css`（2415 行改动）横跨 ② 和 ③：

| 成分 | 行数占比 | 归属 |
|---|---|---|
| `--*` 主题变量 | 307 行 | ③ |
| `.detail-*` 弹窗布局 | 22 行 | ③ |
| `.trend-*` 趋势图 | 29 行 | ② |

**建议：不要拆。** 把 `global.css` 整体放进 ③。理由：
- `.trend-*` 只有 29 行，拆出来收益极小；
- ② 单独提交时趋势图会短暂「有 DOM 没样式」，但这个中间态不进入主干（除非你要 bisect）;
- 若确实需要 `git add -p`，按 hunk 拆 43 个 hunk 的出错风险高于收益。

**替代方案（更干净）**：把 ② 和 ③ 合并为一个提交 `feat: 深色主题重做与功能补齐`。
代价是单次提交较大，但每个提交都是完整可用的。

---

## 5. 执行清单

```bash
cd D:/work/AI/strong/trainer

# —— 提交 ① 素材与数据管线 ——
git add -A src/lib/guide            # 924 删除中的 15 个
git add -A public/assets            # 924 删除中的 906 个
git add scripts/ src/lib/types.ts src/lib/store.ts src/lib/catalog.json \
        src/lib/attribution.ts package.json
git commit -m "refactor: 动作素材改为 GIF，教程内容迁入 catalog.json"

# —— 提交 ② 功能补齐 ——
git add src/components/StrengthTrend.tsx src/App.tsx src/components/HistoryView.tsx \
        src/components/BrowseView.tsx src/components/TimerView.tsx \
        src/components/BuildView.tsx src/components/PlanWizard.tsx \
        src/lib/persist.ts src/lib/planner.ts src/main.tsx index.html \
        public/sw.js public/manifest.json public/icon.svg public/icon-maskable.svg \
        e2e-trend.cjs e2e-landing.cjs e2e-pwa.cjs e2e-equipment.cjs diag-loc-tag.cjs \
        shot-trend.cjs shot-landing.cjs verify-media.cjs perf-check.cjs README.md
git commit -m "feat: 补齐力量趋势图、智能落点、收藏、PWA 离线与器械选择"

# —— 提交 ③ 主题 + 布局 ——
git add src/styles/global.css src/components/ExerciseDetail.tsx \
        src/components/GuidePanel.tsx e2e-regression.cjs
git commit -m "style: 全局切换深色主题，重做动作详情弹窗布局"

# —— 提交 ④ 工程修复 ——
git add .gitignore audit-product.cjs verify-fix.cjs
git commit -m "chore: 补全截图忽略规则，收口校验脚本"
```

**每步提交后跑一次**：
```bash
npx tsc --noEmit && node e2e-regression.cjs && node e2e-trend.cjs \
  && node e2e-landing.cjs && node e2e-pwa.cjs
```
当前 7/7 全绿，`audit-product.cjs` 的 K2 已确认取色正确。

---

## 6. ⚠️ 一处与既有历史的冲突

`c3a0a76 perf: 动作素材从 PNG 换成矢量 SVG` 和 `0d9e629 refactor: 动作详情改为静态三图并排，放弃动画方案`
这两个提交**被本次改动整体推翻**（SVG → GIF，静态三图 → 单图）。

这不是错误，是方案迭代。但建议在提交 ① 的 message 里写明：

```
refactor: 动作素材改为 GIF，教程内容迁入 catalog.json

推翻 c3a0a76（PNG→SVG）与 0d9e629（静态三图）两个方案：
- SVG 矢量帧在手绘细节上表现力不足，改回数据集原生的 GIF 动画
- 三图并排在弹窗内过于拥挤，改为单张 180×180 动画 + 缩略图列表
- 素材不入库（138 MB），由 npm run media:fetch 拉取
```

---

## 7. 顺带一提：评审报告里的 P1-3 状态需要更正

我在核对提交分组时发现，**P1-3（收藏 / 排序）其实已部分完成**，与报告里「待办」的记载不符：

- `BrowseView.tsx` 已完整接线 favorites（`favOnly` 筛选、星标切换、传入 `ExerciseDetail`），
  命中行 18/19/83/98/104/172/180/277/301/355/356
- `BuildView.tsx` 已有「上移 / 下移」排序按钮（命中行 80/359/367）

也就是说 P1-3 只差**排序维度的补全**，不是从零开始。建议在提交 ⑤ 里同步更正报告。

**下一个真正该做的事**：**P1-1**（记录实际次数/重量，并在输入时提示「上次同动作」）。
这是唯一直接影响训练数据质量的缺口 —— 没有它，趋势图只能画时长，画不了强度。
