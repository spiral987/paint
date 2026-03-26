"use client";

import Image from "next/image";
import { useState } from "react";


export default function Home() {
  const [resultImage, setResultImage] = useState<string | null>(null);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    
    const file = event.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    // FastAPIサーバーに画像を送信
    const res = await fetch('http://localhost:8000/api/predict', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      // 返ってきた画像データをBlobとして受け取り、URLを生成して表示
      const blob = await res.blob();
      setResultImage(URL.createObjectURL(blob));
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Saliency Map プレビューア</h1>
      <input type="file" onChange={handleUpload} accept="image/*" />
      
      <div style={{ marginTop: '20px' }}>
        {resultImage && (
          <Image src={resultImage} alt="Saliency Map Result" style={{ maxWidth: '100%' }} width={500} height={100} />
        )}
      </div>
    </div>
  );
}
