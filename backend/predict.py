import torch
import torch.nn as nn
from torchvision import transforms as T
from PIL import Image
import matplotlib.pyplot as plt
import os
import numpy as np

# --- 1. モデル定義 ---
# Saliency.ipynb から抽出したネットワーク構造
class DoubleConv(nn.Module):
    def __init__(self, in_channels, out_channels):
        super().__init__()
        self.double_conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True)
        )

    def forward(self, x):
        return self.double_conv(x)

class UNet(nn.Module):
    def __init__(self, n_channels, n_classes):
        super(UNet, self).__init__()
        self.inc = DoubleConv(n_channels, 64)
        self.down1 = nn.MaxPool2d(2)
        self.conv1 = DoubleConv(64, 128)
        self.down2 = nn.MaxPool2d(2)
        self.conv2 = DoubleConv(128, 256)
        self.down3 = nn.MaxPool2d(2)
        self.conv3 = DoubleConv(256, 512)
        self.down4 = nn.MaxPool2d(2)
        self.conv4 = DoubleConv(512, 1024)

        self.up1 = nn.ConvTranspose2d(1024, 512, kernel_size=2, stride=2)
        self.conv5 = DoubleConv(1024, 512)
        self.up2 = nn.ConvTranspose2d(512, 256, kernel_size=2, stride=2)
        self.conv6 = DoubleConv(512, 256)
        self.up3 = nn.ConvTranspose2d(256, 128, kernel_size=2, stride=2)
        self.conv7 = DoubleConv(256, 128)
        self.up4 = nn.ConvTranspose2d(128, 64, kernel_size=2, stride=2)
        self.conv8 = DoubleConv(128, 64)
        self.outc = nn.Conv2d(64, n_classes, kernel_size=1)

    def forward(self, x):
        x1 = self.inc(x)
        x2 = self.conv1(self.down1(x1))
        x3 = self.conv2(self.down2(x2))
        x4 = self.conv3(self.down3(x3))
        x5 = self.conv4(self.down4(x4))
        
        x6 = self.conv5(torch.cat([self.up1(x5), x4], dim=1))
        x7 = self.conv6(torch.cat([self.up2(x6), x3], dim=1))
        x8 = self.conv7(torch.cat([self.up3(x7), x2], dim=1))
        x9 = self.conv8(torch.cat([self.up4(x8), x1], dim=1))
        return self.outc(x9)


# --- 2. 推論用の設定 ---
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
# 学習済みモデルのパスを指定してください
MODEL_PATH = 'best_saliency_model.pth'
TARGET_SIZE = (256, 192)

def get_transform():
    # 入力画像の前処理（ImageNetの平均と標準偏差で正規化）
    return T.Compose([
        T.Resize(TARGET_SIZE),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

def generate_heatmap(image_path, model, device):
    """画像を読み込み、推論を実行してヒートマップと元画像を返す"""
    image = Image.open(image_path).convert('RGB')
    transform = get_transform()
    input_tensor = transform(image).unsqueeze(0).to(device)
    
    with torch.no_grad():
        output = model(input_tensor)
        # 予測結果にSigmoid関数を適用し、0~1の確率値に変換
        pred_map = torch.sigmoid(output).squeeze().cpu().numpy()
        
    return image, pred_map


def save_result(original_image, pred_map, save_path):
    '''
    元画像（original_image）と同じサイズにヒートマップを拡大し、
    半透明でぴったりとオーバーレイ合成して保存する。
    '''
        # 1. 推論結果(0.0~1.0)を0~255のグレースケール画像に変換
    pred_map_img = Image.fromarray(np.uint8(pred_map * 255), mode='L')

    # 2. ヒートマップを元画像の解像度に合わせてリサイズ
    # （Pillowのバージョンにより Image.Resampling.BILINEAR または Image.BILINEAR を使用）
    pred_map_resized = pred_map_img.resize(original_image.size, Image.Resampling.BILINEAR)

    # 3. matplotlibの 'jet' カラーマップを使って、グレースケールをRGBのヒートマップ色に変換
    cmap = plt.get_cmap('jet')
    # cmapには0.0~1.0の値を渡す必要があるため、再度255で割る
    heatmap_rgba = cmap(np.array(pred_map_resized) / 255.0) 

    # 4. RGBA（透過付き）のPIL画像に変換
    heatmap_img = Image.fromarray(np.uint8(heatmap_rgba * 255), mode='RGBA')

    # 5. ヒートマップレイヤー全体の透明度（Alpha値）を 128（約50%）に設定
    heatmap_img.putalpha(128)

    # 6. 元画像をRGBAに変換し、ヒートマップを上に重ねる（アルファブレンド）
    original_rgba = original_image.convert('RGBA')
    blended = Image.alpha_composite(original_rgba, heatmap_img)

    # 7. RGBに戻して保存
    blended.convert('RGB').save(save_path)

# --- 3. メイン実行部 ---
if __name__ == "__main__":
    input_img = "canvas.png"        # クリスタ等から書き出した監視対象の画像
    output_img = "output_saliency.png" # 生成されるヒートマップ画像
    
    if not os.path.exists(MODEL_PATH):
        print(f"エラー: 学習済みモデル '{MODEL_PATH}' が見つかりません。")
    elif not os.path.exists(input_img):
        print(f"エラー: 入力画像 '{input_img}' が見つかりません。")
    else:
        print("モデルを読み込み中...")
        model = UNet(n_channels=3, n_classes=1).to(DEVICE)
        model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
        model.eval()
        
        print(f"'{input_img}' の視線マップを推論中...")
        img, heatmap = generate_heatmap(input_img, model, DEVICE)
        
        print(f"結果を '{output_img}' に保存中...")
        save_result(img, heatmap, output_img)
        print("推論が完了しました！")