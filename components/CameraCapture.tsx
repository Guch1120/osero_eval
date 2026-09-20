"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onCapture: (photo: { data: string; mimeType: string }) => void;
  onCancel: () => void;
  onFallbackToFile: () => void;
}

// The native OS camera app (opened via <input capture>) can't show a
// custom framing guide, which makes it easy to capture too much
// background/hands around the board and hurt digitization accuracy. This
// component uses getUserMedia directly so we can overlay a square guide
// and crop the captured frame to exactly that square before upload.

const SAFE_BASE64_LENGTH = 3_000_000; // ~2.25MB decoded, well under Vercel's 4.5MB body limit

function shrinkToSafeJpeg(makeCanvas: (maxDim: number) => HTMLCanvasElement): { data: string; mimeType: string } {
  let maxDim = 1600;
  let quality = 0.85;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = makeCanvas(maxDim);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (base64.length <= SAFE_BASE64_LENGTH || attempt === 3) {
      return { data: base64, mimeType: "image/jpeg" };
    }
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.15);
  }
  throw new Error("画像の圧縮に失敗しました。");
}

// Crops the centered square out of the video's native frame. This matches
// exactly what's visible in a square, object-fit:cover preview element,
// so what the user framed in the guide is what gets sent.
export function squareCropFromVideo(video: HTMLVideoElement): { data: string; mimeType: string } {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error("カメラの映像を取得できませんでした。");
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  return shrinkToSafeJpeg((maxDim) => {
    const outSide = Math.min(maxDim, side);
    const canvas = document.createElement("canvas");
    canvas.width = outSide;
    canvas.height = outSide;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像の処理に失敗しました(canvas未対応)。");
    ctx.drawImage(video, sx, sy, side, side, 0, 0, outSide, outSide);
    return canvas;
  });
}

export default function CameraCapture({ onCapture, onCancel, onFallbackToFile }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1920 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (err) {
        setError(
          err instanceof Error ? `カメラを起動できませんでした: ${err.message}` : "カメラを起動できませんでした。"
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function handleShoot() {
    if (!videoRef.current) return;
    try {
      setError(null);
      const photo = squareCropFromVideo(videoRef.current);
      onCapture(photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "撮影に失敗しました。");
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-4">
      <div className="relative w-full max-w-sm aspect-square bg-neutral-900 overflow-hidden rounded-lg">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {ready && (
          <>
            <div className="absolute inset-[6%] border-2 border-dashed border-yellow-300/90 rounded pointer-events-none" />
            <div className="absolute inset-[6%] pointer-events-none flex items-start justify-start">
              <span className="text-yellow-200 text-xs bg-black/50 px-1 rounded m-1">オセロ盤をこの枠に</span>
            </div>
          </>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
            カメラを起動しています...
          </div>
        )}
      </div>

      <p className="text-white text-sm text-center max-w-sm">
        盤面の真上に近い角度からスマホをかざし、盤全体が黄色い枠にちょうど収まるように調整してから撮影してください。手や周囲の物はできるだけ写らないようにしてください。
      </p>

      {error && <p className="text-red-300 text-sm text-center max-w-sm">{error}</p>}

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={handleShoot}
          disabled={!ready}
          className="px-5 py-2 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          撮影する
        </button>
        <button
          onClick={onFallbackToFile}
          className="px-4 py-2 rounded border border-white/60 text-white hover:bg-white/10"
        >
          ファイルから選ぶ
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded border border-white/60 text-white hover:bg-white/10">
          キャンセル
        </button>
      </div>
    </div>
  );
}
