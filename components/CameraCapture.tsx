"use client";

import { useEffect, useRef, useState } from "react";
import { capturedImageFromVideoSquareCrop } from "@/lib/imageCapture";
import { analyzeBoardImageData, type VisionAnalysis } from "@/lib/boardVision";

interface Props {
  onCapture: (analysis: VisionAnalysis) => void;
  onCancel: () => void;
  onFallbackToFile: () => void;
}

// The native OS camera app (opened via <input capture>) can't show a
// custom framing guide, which makes it easy to capture too much
// background/hands around the board and hurt digitization accuracy. This
// component uses getUserMedia directly so we can overlay a square guide;
// on shoot, it crops the frame to exactly that square and runs the
// classical CV board reader (lib/boardVision.ts) on it locally — no photo
// ever leaves the device.

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
      const captured = capturedImageFromVideoSquareCrop(videoRef.current);
      const analysis = analyzeBoardImageData(captured);
      onCapture(analysis);
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
