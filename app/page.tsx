"use client";

import { useRef, useState } from "react";
import BoardGrid from "@/components/BoardGrid";
import EvalBar from "@/components/EvalBar";
import CameraCapture from "@/components/CameraCapture";
import {
  BLACK,
  WHITE,
  type Board,
  type Player,
  initialBoard,
  inferMover,
  other,
} from "@/lib/othello";

interface AnalysisResponse {
  analysis: {
    mover: Player;
    mode: "exact" | "heuristic";
    emptyCount: number;
    blackWinProb: number;
    whiteWinProb: number;
    drawish: boolean;
    degradedToHeuristic: boolean;
    best: { move: number; notation: string; score: number } | null;
    candidates: { move: number; notation: string; score: number }[];
  };
  explanation: string;
  explanationSource: "llm" | "fallback";
}

function playerLabel(p: Player): string {
  return p === BLACK ? "黒" : "白";
}

// Phone camera photos (often 4-12MB) are sent as base64 JSON, which adds
// ~33% overhead and can exceed Vercel's ~4.5MB serverless request body
// limit. That limit is enforced by the platform before our route handler
// even runs, so an oversized upload comes back as a plain-text 413 rather
// than JSON. We avoid that entirely by downscaling/recompressing the
// photo client-side first; this also keeps the vision API call fast.
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

async function compressImageFile(file: File): Promise<{ data: string; mimeType: string }> {
  const drawable = await loadDrawable(file);
  const naturalWidth = "width" in drawable ? drawable.width : 0;
  const naturalHeight = "height" in drawable ? drawable.height : 0;

  let maxDim = 1600;
  let quality = 0.85;
  const SAFE_BASE64_LENGTH = 3_000_000; // ~2.25MB decoded, well under the 4.5MB body limit

  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight, 1));
    const w = Math.max(1, Math.round(naturalWidth * scale));
    const h = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像の処理に失敗しました(canvas未対応)。");
    ctx.drawImage(drawable, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const comma = dataUrl.indexOf(",");
    const base64 = dataUrl.slice(comma + 1);
    if (base64.length <= SAFE_BASE64_LENGTH || attempt === 3) {
      if ("close" in drawable) drawable.close();
      return { data: base64, mimeType: "image/jpeg" };
    }
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.15);
  }
  throw new Error("画像の圧縮に失敗しました。");
}

// Reads a fetch Response as JSON, but degrades gracefully when the body
// isn't JSON at all (e.g. Vercel's own plain-text error pages for 413/504),
// which previously surfaced as an opaque "Unexpected token" parse error.
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) {
    throw new Error(`サーバーエラー (status ${res.status}): 応答が空でした。`);
  }
  try {
    return JSON.parse(text);
  } catch {
    const hint = res.status === 413 ? "写真のデータが大きすぎる可能性があります。" : "";
    throw new Error(`サーバーエラー (status ${res.status})。${hint} ${text.slice(0, 200)}`.trim());
  }
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [confirmedBoard, setConfirmedBoard] = useState<Board | null>(null);
  const [lastMover, setLastMover] = useState<Player | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  const [draftBoard, setDraftBoard] = useState<Board | null>(null);
  const [draftNextMover, setDraftNextMover] = useState<Player>(BLACK);
  const [moverInferred, setMoverInferred] = useState(true);
  const [digitizeNotes, setDigitizeNotes] = useState<{ confidence: number; notes: string } | null>(null);

  const [busy, setBusy] = useState<"digitize" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  function buildErrorReport(message: string): string {
    return [
      "[オセロ評価AI エラーレポート]",
      `日時: ${new Date().toISOString()}`,
      `内容: ${message}`,
      `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
      `URL: ${typeof window !== "undefined" ? window.location.href : "unknown"}`,
    ].join("\n");
  }

  async function copyErrorReport() {
    if (!error) return;
    const report = buildErrorReport(error);
    try {
      await navigator.clipboard.writeText(report);
      setErrorCopied(true);
      setTimeout(() => setErrorCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable/blocked; the textarea below still
      // lets the user select-all and copy manually.
    }
  }

  function startNewGame() {
    setConfirmedBoard(initialBoard());
    setLastMover(null);
    setResult(null);
    setDraftBoard(null);
    setError(null);
  }

  function startManualEntry() {
    const base = draftBoard ?? confirmedBoard ?? initialBoard();
    setDraftBoard([...base] as Board);
    setDraftNextMover(confirmedBoard && lastMover ? other(lastMover) : BLACK);
    setMoverInferred(false);
    setDigitizeNotes(null);
    setError(null);
  }

  async function submitPhotoForDigitize(data: string, mimeType: string) {
    setError(null);
    setBusy("digitize");
    try {
      const res = await fetch("/api/digitize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: data, mimeType }),
      });
      const json = await safeJson(res);
      if (!res.ok) {
        throw new Error(`${json.error || "盤面認識に失敗しました。"}${json.requestId ? ` (ID: ${json.requestId})` : ""}`);
      }

      const newBoard: Board = json.board;
      setDraftBoard(newBoard);
      setDigitizeNotes({ confidence: json.confidence, notes: json.notes });

      if (confirmedBoard) {
        const justMoved = inferMover(confirmedBoard, newBoard);
        if (justMoved) {
          setDraftNextMover(other(justMoved));
          setMoverInferred(true);
        } else {
          setDraftNextMover(lastMover ? other(lastMover) : BLACK);
          setMoverInferred(false);
        }
      } else {
        setDraftNextMover(BLACK);
        setMoverInferred(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const { data, mimeType } = await compressImageFile(file);
      await submitPhotoForDigitize(data, mimeType);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openCameraOrFilePicker() {
    setError(null);
    if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
      setShowCamera(true);
    } else {
      fileInputRef.current?.click();
    }
  }

  function handleCameraCapture(photo: { data: string; mimeType: string }) {
    setShowCamera(false);
    void submitPhotoForDigitize(photo.data, photo.mimeType);
  }

  function cycleCell(i: number) {
    if (!draftBoard) return;
    const next = [...draftBoard] as Board;
    next[i] = ((next[i] + 1) % 3) as Board[number];
    setDraftBoard(next);
  }

  async function confirmAndEvaluate() {
    if (!draftBoard) return;
    setError(null);
    setBusy("evaluate");
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: draftBoard, mover: draftNextMover }),
      });
      const json = await safeJson(res);
      if (!res.ok) {
        throw new Error(`${json.error || "評価に失敗しました。"}${json.requestId ? ` (ID: ${json.requestId})` : ""}`);
      }

      setConfirmedBoard(draftBoard);
      setLastMover(draftNextMover);
      setResult(json);
      setDraftBoard(null);
      setDigitizeNotes(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const displayBoard = draftBoard ?? confirmedBoard;
  const analysis = result?.analysis;

  return (
    <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">オセロ評価AI</h1>
        <p className="text-sm text-neutral-600 mt-1">
          将棋の指し手評価AIのように、一手ごとに盤面を撮影して勝率と理由を確認できます。
        </p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPhotoChosen}
      />

      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onCancel={() => setShowCamera(false)}
          onFallbackToFile={() => {
            setShowCamera(false);
            fileInputRef.current?.click();
          }}
        />
      )}

      {!confirmedBoard && !draftBoard && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={startNewGame}
            className="px-4 py-2 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800"
          >
            初期配置から開始
          </button>
          <button
            onClick={openCameraOrFilePicker}
            disabled={busy === "digitize"}
            className="px-4 py-2 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-50"
          >
            {busy === "digitize" ? "読み取り中..." : "今の盤面を撮影して開始"}
          </button>
          <button
            onClick={startManualEntry}
            className="px-4 py-2 rounded border border-neutral-400 hover:bg-neutral-100"
          >
            現在の盤面を手動入力
          </button>
        </div>
      )}

      {displayBoard && (
        <section className="space-y-3">
          <BoardGrid
            board={displayBoard}
            editable={!!draftBoard}
            onCellClick={draftBoard ? cycleCell : undefined}
            bestMove={draftBoard ? undefined : analysis?.best?.move ?? null}
            candidateMoves={draftBoard ? undefined : analysis?.candidates.slice(1, 3).map((c) => c.move)}
          />

          {draftBoard && (
            <div className="space-y-2 text-sm">
              {digitizeNotes && (
                <p className="text-neutral-600">
                  読み取り信頼度: {(digitizeNotes.confidence * 100).toFixed(0)}%
                  {digitizeNotes.notes && ` / ${digitizeNotes.notes}`}
                </p>
              )}
              <p className="text-neutral-700">
                盤面が写真と違う場合は石をタップして修正できます(空き→黒→白→空きの順で切り替わります)。
              </p>
              <div className="flex items-center gap-2">
                <span>次の手番:</span>
                <div className="flex rounded overflow-hidden border border-neutral-400">
                  {([BLACK, WHITE] as Player[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setDraftNextMover(p);
                        setMoverInferred(false);
                      }}
                      className={`px-3 py-1 ${
                        draftNextMover === p ? "bg-emerald-700 text-white" : "bg-white hover:bg-neutral-100"
                      }`}
                    >
                      {playerLabel(p)}
                    </button>
                  ))}
                </div>
                {!moverInferred && <span className="text-xs text-amber-600">要確認</span>}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={confirmAndEvaluate}
                  disabled={busy === "evaluate"}
                  className="px-4 py-2 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-50"
                >
                  {busy === "evaluate" ? "評価中..." : "この盤面で評価する"}
                </button>
                <button
                  onClick={() => {
                    setDraftBoard(null);
                    setDigitizeNotes(null);
                  }}
                  className="px-4 py-2 rounded border border-neutral-400 hover:bg-neutral-100"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {!draftBoard && confirmedBoard && (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={openCameraOrFilePicker}
                disabled={busy === "digitize"}
                className="px-4 py-2 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-50"
              >
                {busy === "digitize" ? "読み取り中..." : "石を置いたら撮影"}
              </button>
              <button
                onClick={startManualEntry}
                className="px-4 py-2 rounded border border-neutral-400 hover:bg-neutral-100"
              >
                手動で修正入力
              </button>
              <button
                onClick={startNewGame}
                className="px-4 py-2 rounded border border-neutral-400 hover:bg-neutral-100 text-sm"
              >
                最初からやり直す
              </button>
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="text-sm bg-red-50 border border-red-200 rounded p-3 space-y-2">
          <p className="text-red-600">{error}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyErrorReport}
              className="px-3 py-1 text-xs rounded border border-red-300 text-red-700 hover:bg-red-100"
            >
              {errorCopied ? "コピーしました" : "エラーログをコピー"}
            </button>
            <span className="text-xs text-red-400">コピーしてサポートに貼り付けられます</span>
          </div>
          <textarea
            readOnly
            value={buildErrorReport(error)}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full text-xs font-mono bg-white border border-red-200 rounded p-2 h-24 resize-none"
          />
        </div>
      )}

      {analysis && result && (
        <section className="space-y-3 border-t pt-4">
          <h2 className="font-semibold">
            {playerLabel(analysis.mover)}の手番の評価
            {analysis.mode === "exact" ? "(終盤読み切り)" : "(簡易評価)"}
          </h2>
          <EvalBar blackPct={analysis.blackWinProb * 100} whitePct={analysis.whiteWinProb * 100} />
          {analysis.degradedToHeuristic && (
            <p className="text-xs text-amber-600">
              終盤の完全読み切りが計算量の上限に達したため、簡易評価にフォールバックしました。
            </p>
          )}
          {analysis.best && (
            <p className="text-sm">
              最善手候補:{" "}
              <span className="font-mono font-semibold">{analysis.best.notation}</span>
              {analysis.candidates.length > 1 && (
                <span className="text-neutral-500">
                  {" "}
                  (次点: {analysis.candidates.slice(1, 3).map((c) => c.notation).join(", ")})
                </span>
              )}
            </p>
          )}
          <p className="text-sm leading-relaxed whitespace-pre-wrap bg-neutral-50 border border-neutral-200 rounded p-3">
            {result.explanation}
          </p>
          {result.explanationSource === "fallback" && (
            <p className="text-xs text-neutral-400">
              ※ LLMによる解説の取得に失敗したため、数値のみから自動生成した簡易解説を表示しています。
            </p>
          )}
        </section>
      )}
    </main>
  );
}
