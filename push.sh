#!/bin/bash
# TinyPaw 推送脚本
# 用于将代码推送到 GitHub

set -e

echo "🦎 TinyPaw - 推送到 GitHub"
echo ""

cd "$(dirname "$0")"

# 检查远程仓库
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "添加远程仓库..."
  git remote add origin git@github.com:pawofcat/tinypaw.git
fi

# 确保分支为 main
git branch -M main 2>/dev/null || true

# 推送
echo "推送到 GitHub..."
git push -u origin main

echo ""
echo "✅ 推送成功！"
echo "查看项目：https://github.com/pawofcat/tinypaw"
