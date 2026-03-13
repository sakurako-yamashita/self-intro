#!/usr/bin/env bash
# GitHub Pages 用: リポジトリ作成 → push → Pages 有効化
set -e

PROJECT_DIR="c:/Users/mari/OneDrive/デスクトップ/My-First-Project"
REPO_NAME="self-intro"

cd "$PROJECT_DIR"

GITHUB_USER=$(gh api user -q .login)
echo "GitHub ユーザー: $GITHUB_USER"

echo "1. GitHub にリポジトリを作成して push..."
gh repo create "$REPO_NAME" --public --source=. --remote=origin --push --description "山下桜子 自己紹介ページ"

echo ""
echo "2. GitHub Pages を有効化..."
gh api repos/"$GITHUB_USER"/"$REPO_NAME"/pages -X POST -f source='{"branch":"master","path":"/"}'

echo ""
echo "完了！"
echo "公開URL: https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo "（反映まで数分かかることがあります）"
