import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { digitizeBoardFromPhoto } from "@/lib/gemini";
import { logError, logInfo, logWarn } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

// Vercel's platform-level request body limit for serverless functions is
// 4.5MB regardless of any app-level config. A base64-encoded photo is
// ~33% bigger than the original file, so we reject (with a clear message)
// anything that would risk hitting that wall instead of letting Vercel
// return a bare-text 413 that breaks JSON parsing on the client.
const MAX_BASE64_LENGTH = 5_000_000; // ~3.75MB decoded

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch (err) {
    logError("digitize", "request body was not valid JSON", err, { requestId });
    return NextResponse.json({ error: "リクエストの形式が不正です。", requestId }, { status: 400 });
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64 || !mimeType) {
    logWarn("digitize", "missing imageBase64/mimeType", { requestId });
    return NextResponse.json({ error: "imageBase64 と mimeType が必要です。", requestId }, { status: 400 });
  }

  if (imageBase64.length > MAX_BASE64_LENGTH) {
    logWarn("digitize", "payload too large, rejected before calling Gemini", {
      requestId,
      approxBytes: Math.floor((imageBase64.length * 3) / 4),
    });
    return NextResponse.json(
      { error: "写真のデータが大きすぎます。解像度を下げて撮り直してください。", requestId },
      { status: 413 }
    );
  }

  logInfo("digitize", "request received", {
    requestId,
    mimeType,
    approxBytes: Math.floor((imageBase64.length * 3) / 4),
  });

  try {
    const result = await digitizeBoardFromPhoto(imageBase64, mimeType);
    logInfo("digitize", "digitize succeeded", {
      requestId,
      confidence: result.confidence,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ...result, requestId });
  } catch (err) {
    logError("digitize", "digitize failed", err, { requestId, elapsedMs: Date.now() - startedAt });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, requestId }, { status: 502 });
  }
}
