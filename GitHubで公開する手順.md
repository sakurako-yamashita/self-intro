# 自己紹介ページを GitHub で公開する手順

## やること
いまある「自己紹介のHTML」を、インターネット上のアドレス（URL）で誰でも見られるようにします。

---

## リポジトリはもう作成済みの場合（今のあなた用）

GitHub で **sakurako-yamashita/self-intro** を作ったあと、**ローカルのコードを GitHub に送る**だけです。

### ステップ1: ターミナルを開く
Cursor の下にある **「ターミナル」** をクリック。

### ステップ2: 次の3つを順番に実行する

**① プロジェクトのフォルダに移動**
```
cd "c:\Users\mari\OneDrive\デスクトップ\My-First-Project"
```

**② ブランチ名を main にして、GitHub に送る（push）**
```
git branch -M main
git push -u origin main
```
→ ここで **GitHub のログイン** を求められたら、ブラウザが開くのでログインして「Authorize」する。

**③ GitHub で Pages をオンにする**
1. ブラウザで **https://github.com/sakurako-yamashita/self-intro** を開く
2. **Settings** → 左の **Pages**
3. **Source** で **Deploy from a branch** を選ぶ
4. **Branch** を **main** にして **Save**

### ステップ3: 公開URLを開く
2〜3分待ってから、次のURLを開く。

**https://sakurako-yamashita.github.io/self-intro/**

ここが、自己紹介ページの「リンクで共有できるURL」です。

---

## うまくいかないとき

- **push で「Permission denied」や「認証」エラー**  
  → ターミナルで `git push -u origin main` をもう一度実行。表示に従って GitHub にログインする。

- **404 のまま**  
  → Settings → Pages で **Branch が main** になっているか確認。保存して数分待つ。
