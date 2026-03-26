# main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
# 先ほどのスクリプトから推論関数をインポート（predict.pyに必要な関数が定義されている前提）
from predict import generate_heatmap, save_result, UNet, DEVICE, MODEL_PATH
import torch

app = FastAPI()

# Next.js（フロントエンド）からの通信を許可するCORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # Next.jsのデフォルトポート
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# モデルの事前読み込み（起動時に1回だけ実行して高速化）
model = UNet(n_channels=3, n_classes=1).to(DEVICE)
model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
model.eval()

@app.post("/api/predict")
async def predict_saliency(file: UploadFile = File(...)):
    """画像を受け取り、推論結果の画像を返すAPI"""
    input_path = f"temp_{file.filename}"
    output_path = f"result_{file.filename}"
    
    # 1. アップロードされた画像を一時保存
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # 2. 推論と合成の実行
    img, heatmap = generate_heatmap(input_path, model, DEVICE)
    save_result(img, heatmap, output_path)
    
    # 3. 終わったら一時ファイルを削除
    os.remove(input_path)
    
    # 4. 合成された画像をフロントエンドに返す
    return FileResponse(output_path, media_type="image/png")