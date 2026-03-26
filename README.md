# Saliency Map 描画支援プレビューア

## 概要

- 目的: イラスト制作時における視線誘導（Saliency Map）を可視化し、構図の検討や客観的な評価を支援する
- 主な機能:
    - Screen Capture APIを利用した描画キャンバス（特定ウィンドウ）のリアルタイム取得と領域切り抜き
    - PyTorch (UNetベース) による視線マップの高速推論
    - 元画像に対するヒートマップの半透明オーバーレイ表示
- 想定ユーザー: イラストレーター / クリエイティビティ・サポート・ツール（HCI）の研究用途

## 技術スタック

- Frontend: Next.js / TypeScript / Tailwind CSS
- Backend: Python / FastAPI / PyTorch
- モデル: `backend/best_saliency_model.pth`

## ディレクトリ構成

```txt
paint/
    backend/
        main.py
        predict.py
        best_saliency_model.pth
    frontend/
        app/
        public/
```

## セットアップ

### 前提条件

- Node.js: 18.x 以上推奨
- Python: 3.8 以上推奨

### Backend

```bash
cd backend
# 仮想環境作成
python -m venv .venv

# 仮想環境有効化（Windowsの場合）
.venv\Scripts\activate

# 依存関係インストール
pip install fastapi uvicorn python-multipart torch torchvision pillow numpy matplotlib
```

### Frontend

```bash
cd frontend
npm install
```

## 起動方法

### Backend 起動

```bash
cd backend
# uvicornのパスエラーを防ぐためモジュールとして実行
python -m uvicorn main:app --reload
```

### Frontend 起動

```bash
cd frontend
npm run dev
```

## 使い方

1. フロントエンドを開く（ `http://localhost:3000` ）
2. 「画面キャプチャ開始」ボタンを押し、ペイントツール（Clip Studio Paint等）のウィンドウを選択する
3. ブラウザ上で推論対象としたいキャンバス領域をドラッグして指定する
4. 以降、指定領域の視線マップ推論結果がリアルタイムで更新・表示される

## APIリファレンス

### `POST /api/predict`

- 説明: 画像を受け取り、推論結果のヒートマップ合成画像を返す
- Request: `multipart/form-data` (key: `file`)
- Response: `image/png`

## 既知の課題

- 描画ツール側のUI（パレット等）がキャプチャ領域に被ると推論精度に影響が出る
- ループ処理の間隔調整（PCの負荷軽減とリアルタイム性のトレードオフ）

## 今後の予定

- [ ] クロップUI（領域選択機能）の実装
- [ ] バックエンドとのWebSocket通信による推論ループの最適化
- [ ] 正方形キャンバス向けトリミング提案機能の追加
