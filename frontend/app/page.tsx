"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragMode =
  | { type: "create"; start: { x: number; y: number } }
  | { type: "move"; start: { x: number; y: number }; baseRect: Rect }
  | {
      type: "resize";
      start: { x: number; y: number };
      baseRect: Rect;
      handle: ResizeHandle;
    };

type InteractionMode = "pan" | "crop";

const MIN_SELECTION_SIZE = 8;

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};


export default function Home() {
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureIntervalSec, setCaptureIntervalSec] = useState(3);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [draftSelection, setDraftSelection] = useState<Rect | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("pan");
  const [stageZoom, setStageZoom] = useState(1);
  const [stagePan, setStagePan] = useState({ x: 0, y: 0 });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const dragModeRef = useRef<DragMode | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const activeRect = draftSelection || selection;

  const clampPanToBounds = (nextX: number, nextY: number, zoom: number) => {
    const viewport = viewportRef.current;
    const overlay = overlayRef.current;
    if (!viewport || !overlay) {
      return { x: nextX, y: nextY };
    }

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    const baseWidth = overlay.offsetWidth;
    const baseHeight = overlay.offsetHeight;

    if (!viewportWidth || !viewportHeight || !baseWidth || !baseHeight) {
      return { x: nextX, y: nextY };
    }

    const scaledWidth = baseWidth * zoom;
    const scaledHeight = baseHeight * zoom;

    let x = nextX;
    let y = nextY;

    if (scaledWidth <= viewportWidth) {
      x = (viewportWidth - scaledWidth) / 2;
    } else {
      x = clamp(x, viewportWidth - scaledWidth, 0);
    }

    if (scaledHeight <= viewportHeight) {
      y = (viewportHeight - scaledHeight) / 2;
    } else {
      y = clamp(y, viewportHeight - scaledHeight, 0);
    }

    return { x, y };
  };

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
      setResultImage((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    }
  };

  const stopCapture = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCapturing(false);
    setSelection(null);
    setDraftSelection(null);
    setInteractionMode("pan");
    setStageZoom(1);
    setStagePan({ x: 0, y: 0 });
  };

  const startCapture = async () => {
    setCaptureError(null);
    console.info("[capture] start requested");

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      console.info("[capture] stream acquired", stream.getVideoTracks().length);

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        console.error("[capture] video ref is null");
        setCaptureError("画面キャプチャ表示の初期化に失敗しました。ページを再読み込みしてください。");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      await video.play();
      console.info("[capture] video play started");
      setInteractionMode("pan");
      setStageZoom(1);
      setStagePan({ x: 0, y: 0 });
      setIsCapturing(true);

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          console.info("[capture] stream ended by browser");
          stopCapture();
        });
      }
    } catch (error) {
      console.error("[capture] failed", error);
      setCaptureError("画面キャプチャを開始できませんでした。権限と対象ウィンドウを確認してください。");
    }
  };

  const toOverlayPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return null;

    const bounds = overlay.getBoundingClientRect();
    const baseWidth = overlay.offsetWidth || 1;
    const baseHeight = overlay.offsetHeight || 1;
    const scaleX = bounds.width / baseWidth;
    const scaleY = bounds.height / baseHeight;

    const rawX = (event.clientX - bounds.left) / scaleX;
    const rawY = (event.clientY - bounds.top) / scaleY;

    const x = Math.max(0, Math.min(rawX, baseWidth));
    const y = Math.max(0, Math.min(rawY, baseHeight));

    return { x, y };
  };

  const onMouseDownOverlay = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isCapturing) return;

    if (interactionMode === "pan") {
      panDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        baseX: stagePan.x,
        baseY: stagePan.y,
      };
      return;
    }

    const point = toOverlayPoint(event);
    if (!point) return;

    dragModeRef.current = { type: "create", start: point };
    setDraftSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const onMouseMoveOverlay = (event: React.MouseEvent<HTMLDivElement>) => {
    if (panDragRef.current) {
      const dx = event.clientX - panDragRef.current.startX;
      const dy = event.clientY - panDragRef.current.startY;
      const clamped = clampPanToBounds(
        panDragRef.current.baseX + dx,
        panDragRef.current.baseY + dy,
        stageZoom
      );
      setStagePan(clamped);
      return;
    }

    const dragMode = dragModeRef.current;
    if (!dragMode) return;

    const point = toOverlayPoint(event);
    if (!point) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const baseWidth = overlay.offsetWidth || 0;
    const baseHeight = overlay.offsetHeight || 0;
    if (!baseWidth || !baseHeight) return;

    if (dragMode.type === "create") {
      const x = Math.min(dragMode.start.x, point.x);
      const y = Math.min(dragMode.start.y, point.y);
      const width = Math.abs(point.x - dragMode.start.x);
      const height = Math.abs(point.y - dragMode.start.y);
      setDraftSelection({ x, y, width, height });
      return;
    }

    if (dragMode.type === "move") {
      const dx = point.x - dragMode.start.x;
      const dy = point.y - dragMode.start.y;
      const nextX = clamp(dragMode.baseRect.x + dx, 0, baseWidth - dragMode.baseRect.width);
      const nextY = clamp(dragMode.baseRect.y + dy, 0, baseHeight - dragMode.baseRect.height);
      setDraftSelection({
        x: nextX,
        y: nextY,
        width: dragMode.baseRect.width,
        height: dragMode.baseRect.height,
      });
      return;
    }

    let left = dragMode.baseRect.x;
    let top = dragMode.baseRect.y;
    let right = dragMode.baseRect.x + dragMode.baseRect.width;
    let bottom = dragMode.baseRect.y + dragMode.baseRect.height;

    if (dragMode.handle.includes("w")) {
      left = clamp(point.x, 0, right - MIN_SELECTION_SIZE);
    }
    if (dragMode.handle.includes("e")) {
      right = clamp(point.x, left + MIN_SELECTION_SIZE, baseWidth);
    }
    if (dragMode.handle.includes("n")) {
      top = clamp(point.y, 0, bottom - MIN_SELECTION_SIZE);
    }
    if (dragMode.handle.includes("s")) {
      bottom = clamp(point.y, top + MIN_SELECTION_SIZE, baseHeight);
    }

    setDraftSelection({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  };

  const onMouseUpOverlay = () => {
    if (panDragRef.current) {
      panDragRef.current = null;
      return;
    }

    const current = draftSelection;
    const endedDragMode = dragModeRef.current;
    dragModeRef.current = null;

    if (!current || current.width < MIN_SELECTION_SIZE || current.height < MIN_SELECTION_SIZE) {
      setDraftSelection(null);
      return;
    }

    setSelection(current);
    setDraftSelection(null);

    // Creating a brand-new crop is a one-shot mode. After creation, return to pan mode.
    if (endedDragMode?.type === "create") {
      setInteractionMode("pan");
    }
  };

  const beginMoveSelection = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selection) return;

    event.stopPropagation();
    const point = toOverlayPoint(event);
    if (!point) return;

    dragModeRef.current = {
      type: "move",
      start: point,
      baseRect: selection,
    };
    setDraftSelection(selection);
  };

  const beginResizeSelection =
    (handle: ResizeHandle) => (event: React.MouseEvent<HTMLDivElement>) => {
      if (!selection) return;

      event.stopPropagation();
      const point = toOverlayPoint(event);
      if (!point) return;

      dragModeRef.current = {
        type: "resize",
        start: point,
        baseRect: selection,
        handle,
      };
      setDraftSelection(selection);
    };

  useEffect(() => {
    if (!isCapturing || !selection) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const sendCroppedFrame = async () => {
      const video = videoRef.current;
      const canvas = hiddenCanvasRef.current;
      const overlay = overlayRef.current;
      const crop = selection;

      if (!video || !canvas || !overlay || !crop) return;
      if (!video.videoWidth || !video.videoHeight) return;

      const baseWidth = overlay.offsetWidth;
      const baseHeight = overlay.offsetHeight;
      if (!baseWidth || !baseHeight) return;

      const scaleX = video.videoWidth / baseWidth;
      const scaleY = video.videoHeight / baseHeight;

      const sx = Math.round(crop.x * scaleX);
      const sy = Math.round(crop.y * scaleY);
      const sw = Math.round(crop.width * scaleX);
      const sh = Math.round(crop.height * scaleY);

      if (sw <= 0 || sh <= 0) return;

      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((data) => resolve(data), "image/png", 0.95);
      });

      if (!blob) return;

      const formData = new FormData();
      formData.append("file", blob, "capture.png");

      try {
        const res = await fetch("http://localhost:8000/api/predict", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) return;

        const responseBlob = await res.blob();
        setResultImage((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(responseBlob);
        });
      } catch {
        setCaptureError("切り抜き画像の送信に失敗しました。バックエンド接続を確認してください。");
      }
    };

    intervalRef.current = window.setInterval(() => {
      void sendCroppedFrame();
    }, captureIntervalSec * 1000);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isCapturing, selection, captureIntervalSec]);

  useEffect(() => {
    const syncPanOnResize = () => {
      setStagePan((prev) => clampPanToBounds(prev.x, prev.y, stageZoom));
    };

    syncPanOnResize();
    window.addEventListener("resize", syncPanOnResize);

    return () => {
      window.removeEventListener("resize", syncPanOnResize);
    };
  }, [stageZoom]);

  const onWheelViewport = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!isCapturing) return;

    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    const nextZoom = clamp(stageZoom + delta, 1, 6);

    const worldX = (cursorX - stagePan.x) / stageZoom;
    const worldY = (cursorY - stagePan.y) / stageZoom;
    const nextPanX = cursorX - worldX * nextZoom;
    const nextPanY = cursorY - worldY * nextZoom;

    setStageZoom(nextZoom);
    setStagePan(clampPanToBounds(nextPanX, nextPanY, nextZoom));
  };

  useEffect(() => {
    return () => {
      stopCapture();
      setResultImage((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_15%,#1f2937,transparent_38%),radial-gradient(circle_at_85%_5%,#7c2d12,transparent_35%),linear-gradient(180deg,#0b1020_0%,#060911_100%)] px-4 py-8 text-slate-100 md:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-md md:p-7">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Live Capture</p>
              <h1 className="mt-2 text-2xl font-semibold leading-tight text-white md:text-4xl">
                Saliency Crop Studio
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 md:text-base">
                画面を共有して、キャンバス領域だけをドラッグ選択。選択範囲は{captureIntervalSec}秒ごとに推論APIへ送信されます。
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                isCapturing
                  ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/30"
                  : "bg-slate-400/20 text-slate-200 ring-1 ring-white/15"
              }`}
            >
              {isCapturing ? "Capturing" : "Idle"}
            </span>
          </header>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              onClick={startCapture}
              disabled={isCapturing}
              className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              画面をキャプチャ
            </button>
            <button
              onClick={stopCapture}
              disabled={!isCapturing}
              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              キャプチャ停止
            </button>

            <button
              onClick={() => setInteractionMode("crop")}
              disabled={!isCapturing}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                interactionMode === "crop"
                  ? "bg-fuchsia-300 text-slate-950"
                  : "border border-fuchsia-200/40 bg-fuchsia-200/15 text-fuchsia-100 hover:bg-fuchsia-200/25"
              }`}
            >
              トリミング
            </button>

            <label className="ml-0 cursor-pointer rounded-xl border border-amber-200/40 bg-amber-200/15 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-200/25 md:ml-auto">
              画像をアップロード
              <input
                type="file"
                onChange={handleUpload}
                accept="image/*"
                className="hidden"
              />
            </label>
          </div>

          <div className="mb-5 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="capture-interval" className="text-sm font-medium text-slate-200">
                送信インターバル
              </label>
              <span className="rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-200">
                {captureIntervalSec} 秒
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <input
                id="capture-interval"
                type="range"
                min={1}
                max={10}
                step={1}
                value={captureIntervalSec}
                onChange={(event) => setCaptureIntervalSec(Number(event.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-cyan-300"
              />
              <input
                type="number"
                min={1}
                max={10}
                value={captureIntervalSec}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isNaN(next)) return;
                  setCaptureIntervalSec(Math.max(1, Math.min(10, next)));
                }}
                className="w-20 rounded-lg border border-white/15 bg-slate-950/70 px-2 py-1.5 text-right text-sm text-slate-100"
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">1〜10秒の範囲で調整できます。</p>
            <p className="mt-1 text-xs text-slate-400">
              モード: {interactionMode === "crop" ? "新規トリミング作成" : "移動/ズーム（既存枠は常に編集可）"}
            </p>
          </div>

          {captureError && (
            <p className="mb-4 rounded-xl border border-rose-300/35 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
              {captureError}
            </p>
          )}

          <div
            ref={viewportRef}
            onWheel={onWheelViewport}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-inner"
          >
            {!isCapturing && (
              <div className="grid min-h-[320px] place-items-center px-6 py-10 text-center text-slate-300 md:min-h-[440px]">
                <div>
                  <p className="text-base font-medium text-white">共有待機中</p>
                  <p className="mt-2 text-sm text-slate-400">
                    「画面をキャプチャ」を押して対象ウィンドウを選択してください。
                  </p>
                </div>
              </div>
            )}

            <div
              className="relative w-full origin-top-left transition-transform duration-300 ease-out"
              style={{ transform: `translate3d(${stagePan.x}px, ${stagePan.y}px, 0) scale(${stageZoom})` }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                className={`block w-full object-contain ${isCapturing ? "opacity-100" : "opacity-0"}`}
              />

              <div
                ref={overlayRef}
                onMouseDown={onMouseDownOverlay}
                onMouseMove={onMouseMoveOverlay}
                onMouseUp={onMouseUpOverlay}
                onMouseLeave={onMouseUpOverlay}
                className={`absolute inset-0 bg-black/10 ${
                  isCapturing ? (interactionMode === "crop" ? "cursor-crosshair" : "cursor-grab") : "pointer-events-none"
                }`}
              >
                {activeRect && isCapturing && (
                  <div
                    onMouseDown={beginMoveSelection}
                    className="absolute border-2 border-cyan-300 bg-cyan-300/20 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]"
                    style={{
                      left: `${activeRect.x}px`,
                      top: `${activeRect.y}px`,
                      width: `${activeRect.width}px`,
                      height: `${activeRect.height}px`,
                      cursor: "move",
                    }}
                  >
                    <div
                      onMouseDown={beginResizeSelection("nw")}
                      className="absolute -left-1.5 -top-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-cyan-50 bg-cyan-300"
                    />
                    <div
                      onMouseDown={beginResizeSelection("ne")}
                      className="absolute -right-1.5 -top-1.5 h-3 w-3 cursor-nesw-resize rounded-full border border-cyan-50 bg-cyan-300"
                    />
                    <div
                      onMouseDown={beginResizeSelection("sw")}
                      className="absolute -bottom-1.5 -left-1.5 h-3 w-3 cursor-nesw-resize rounded-full border border-cyan-50 bg-cyan-300"
                    />
                    <div
                      onMouseDown={beginResizeSelection("se")}
                      className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-cyan-50 bg-cyan-300"
                    />
                    <div
                      onMouseDown={beginResizeSelection("n")}
                      className="absolute left-1/2 top-0 h-3 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border border-cyan-50/80 bg-cyan-300/90"
                    />
                    <div
                      onMouseDown={beginResizeSelection("s")}
                      className="absolute bottom-0 left-1/2 h-3 w-6 -translate-x-1/2 translate-y-1/2 cursor-ns-resize rounded-full border border-cyan-50/80 bg-cyan-300/90"
                    />
                    <div
                      onMouseDown={beginResizeSelection("w")}
                      className="absolute left-0 top-1/2 h-6 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-cyan-50/80 bg-cyan-300/90"
                    />
                    <div
                      onMouseDown={beginResizeSelection("e")}
                      className="absolute right-0 top-1/2 h-6 w-3 translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-cyan-50/80 bg-cyan-300/90"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-md md:p-7">
          <h2 className="text-lg font-semibold text-white">推論結果</h2>
          <p className="mt-2 text-sm text-slate-300">
            選択領域のサリエンシーマップをここに表示します。
          </p>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
            {resultImage ? (
              <Image
                src={resultImage}
                alt="Saliency Map Result"
                className="h-auto w-full"
                width={900}
                height={500}
              />
            ) : (
              <div className="grid min-h-[260px] place-items-center px-4 py-8 text-center text-sm text-slate-400">
                まだ結果がありません。画像アップロードまたは画面キャプチャを開始してください。
              </div>
            )}
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-slate-900/70 p-4 text-xs leading-relaxed text-slate-300">
            <p className="font-semibold text-slate-100">使い方</p>
            <p className="mt-2">1. 画面共有を開始</p>
            <p>2. マウスホイールでズーム、ドラッグで移動</p>
            <p>3. 「トリミング」ボタンで新規範囲を作成（既存枠はいつでも移動・リサイズ可）</p>
            <p>4. {captureIntervalSec}秒ごとに自動で送信・更新</p>
          </div>
        </aside>
      </div>

      <canvas ref={hiddenCanvasRef} className="hidden" />
    </main>
  );
}
