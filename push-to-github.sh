#!/usr/bin/env bash
#
# 一条命令完成「提交 + 推到 GitHub」。
#
# 前提：仓库已在 GitHub 上建好（空仓库即可，不需要初始化 README）。
#
# 用法：
#   bash push-to-github.sh https://github.com/<你的用户名>/<仓库名>.git
#
# 为什么分成多个提交：工作区里积压的不只是本次部署改动，
# 还有素材迁移（906 个删除）与几轮功能迭代。混成一个提交的话，
# 「删除 906 个 SVG」会和「加部署配置」糊在一起，以后没法单独回滚。
#
set -euo pipefail

REMOTE_URL="${1:-}"
if [ -z "$REMOTE_URL" ]; then
  echo "用法: bash push-to-github.sh <仓库地址>"
  echo "例如: bash push-to-github.sh https://github.com/me/strong-trainer.git"
  exit 1
fi

REPO_NAME=$(basename "$REMOTE_URL" .git)
echo "仓库名: $REPO_NAME"
echo "地址:   $REMOTE_URL"
echo

# 确认部署配置里推导出的路径和仓库名一致 —— 不一致会导致 Pages 白屏
if ! grep -q 'BASE_PATH' .github/workflows/deploy-pages.yml; then
  echo "✗ 工作流里找不到 BASE_PATH 注入，Pages 会白屏"
  exit 1
fi
echo "✓ 部署工作流会按仓库名注入 BASE_PATH=/$REPO_NAME/"
echo

# 1) 配置远程（已存在则更新）
if git remote get-url origin >/dev/null 2>&1; then
  echo "→ 更新 origin"
  git remote set-url origin "$REMOTE_URL"
else
  echo "→ 添加 origin"
  git remote add origin "$REMOTE_URL"
fi

# 2) 分支名统一成 main（GitHub 默认）
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "main" ]; then
  echo "→ 当前分支 $CURRENT，重命名为 main"
  git branch -M main
fi

# 3) 提交 ①：素材与数据管线迁移
#    工作区里那 906 个删除是 SVG→GIF 迁移的落地，不是误删。
echo
echo "→ 提交 ①：素材与数据管线迁移"
git add -A public/assets src/lib/guide 2>/dev/null || true
git add -A public/media 2>/dev/null || true
git add scripts/ src/lib/types.ts src/lib/catalog.json src/lib/attribution.ts 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -m "refactor: 动作素材改用 GIF，教程内容迁入 catalog.json" --quiet
  echo "  ✓ 已提交"
else
  echo "  - 无改动，跳过"
fi

# 4) 提交 ②：功能与部署
echo "→ 提交 ②：功能补齐 + GitHub Pages 部署"
git add -A src/ index.html vite.config.ts public/ README.md .gitignore 2>/dev/null || true
git add .github/ 2>/dev/null || true
git add e2e-*.cjs verify-*.cjs audit-product.cjs diag-*.cjs \
        shot-*.cjs perf-check.cjs COMMIT-PLAN.md 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -m "feat: 器械选择功能与 GitHub Pages 部署配置" --quiet
  echo "  ✓ 已提交"
else
  echo "  - 无改动，跳过"
fi

# 5) 剩下的一次性产物
echo "→ 提交 ③：其余改动"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore: 收口其余改动" --quiet
  echo "  ✓ 已提交"
else
  echo "  - 无改动，跳过"
fi

echo
echo "→ 推送到 GitHub"
git push -u origin main

echo
echo "======================================"
echo "推送完成。接下来："
echo
echo "1. 打开仓库 Settings → Pages"
echo "   Build and deployment → Source 选「GitHub Actions」"
echo "   （不选这一步 Pages 不会更新，且不会有任何报错）"
echo
echo "2. 看 Actions 页面的 Deploy 工作流跑完（约 3-6 分钟，要下载 138MB 素材）"
echo
echo "3. 你的链接是："
echo "   https://<你的用户名>.github.io/$REPO_NAME/"
echo "======================================"
