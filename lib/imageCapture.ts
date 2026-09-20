// Browser-only helpers that turn a File or a live <video> frame into the
// square ImageData the classical CV in lib/boardVision.ts expects. Kept
// separate from boardVision.ts so the analysis algorithm itself stays
// DOM-free and testable under plain Node.

const ANALYSIS_SIZE = 640; // plenty of resolution for 8x8 cell classification, fast to process

export interface CapturedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

async function loadDrawable(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> based loading (e.g. unsupported format)
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function squareCropToCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  size: number
): HTMLCanvasElement {
  const side = Math.min(sourceWidth, sourceHeight);
  const sx = (sourceWidth - side) / 2;
  const sy = (sourceHeight - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の処理に失敗しました(canvas未対応)。");
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

export async function capturedImageFromFile(file: File, size = ANALYSIS_SIZE): Promise<CapturedImage> {
  const drawable = await loadDrawable(file);
  const canvas = squareCropToCanvas(drawable, drawable.width, drawable.height, size);
  if ("close" in drawable) drawable.close();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の処理に失敗しました(canvas未対応)。");
  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}

export function capturedImageFromVideoSquareCrop(video: HTMLVideoElement, size = ANALYSIS_SIZE): CapturedImage {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error("カメラの映像を取得できませんでした。");
  const canvas = squareCropToCanvas(video, vw, vh, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の処理に失敗しました(canvas未対応)。");
  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}
