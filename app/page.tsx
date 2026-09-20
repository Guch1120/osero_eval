"use client";

import { useRef, useState } from "react";
import BoardGrid from "@/components/BoardGrid";
import EvalBar from "@/components/EvalBar";
import CameraCapture from "@/components/CameraCapture";
import { capturedImageFromFile } from "@/lib/imageCapture";
import { analyzeBoardImageData, type VisionAnalysis } from "@/lib/boardVision";
import {
  BLACK,
  WHITE,
  type Board,
  type Player,
  applyMove,
  countDiscs,
  initialBoard,
  inferMover,
  isGameOver,
  legalMoves,
  nextMoverAfterMove,
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
}

function playerLabel(p: Player): string {
  return p === BLACK ? "黒" : "白";
}

function DiscIcon({ color }: { color: Player }) {
  return (
    <span
      className={`inline-block w-4 h-4 rounded-full align-middle ${
        color === BLACK ? "bg-neutral-900" : "bg-white border border-neutral-400"
      }`}
    />
  );
}

// Reads a fetch Response as JSON, but degrades gracefully when the body
// isn't JSON at all (e.g. Vercel's own plain-text error pages for 5xx),
// which would otherwise surface as an opaque "Unexpected token" parse error.
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) {
    throw new Error(`サーバーエラー (status ${res.status}): 応答が空でした。`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`サーバーエラー (status ${res.status})。${text.slice(0, 200)}`.trim());
  }
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [confirmedBoard, setConfirmedBoard] = useState<Board | null>(null);
  // Whose turn it is to move on confirmedBoard right now. Meaningful only
  // once confirmedBoard is set; driven either by an actual applied move
  // (manual entry — exact, via Othello's own turn/pass rules) or by a
  // photo digitization round (inferred from the disc-count delta, with a
  // manual override since a photo can't be 100% certain).
  const [currentMover, setCurrentMover] = useState<Player>(BLACK);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  const [draftBoard, setDraftBoard] = useState<Board | null>(null);
  const [draftNextMover, setDraftNextMover] = useState<Player>(BLACK);
  const [moverInferred, setMoverInferred] = useState(true);
  const [digitizeNotes, setDigitizeNotes] = useState<{ confidence: number; notes: string } | null>(null);

  const [busy, setBusy] = useState<"digitize" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  // For playing a real game side-by-side: hides the best-move highlight/
  // text so the app doesn't hand you the answer while you're deciding your
  // own move. Where you're *allowed* to move (the legal-move dots) stays
  // visible either way — that's just the rules, not strategic advice.
  const [showBestMove, setShowBestMove] = useState(true);

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
    setCurrentMover(BLACK);
    setResult(null);
    setDraftBoard(null);
    setError(null);
  }

  function startManualEntry() {
    const base = draftBoard ?? confirmedBoard ?? initialBoard();
    setDraftBoard([...base] as Board);
    setDraftNextMover(confirmedBoard ? other(currentMover) : BLACK);
    setMoverInferred(false);
    setDigitizeNotes(null);
    setError(null);
  }

  // Board digitization runs entirely on-device (lib/boardVision.ts, a
  // classical grid-line + brightness classifier — no network call, no
  // external API). This just applies the result to component state,
  // shared by both the in-app camera and the file-picker fallback.
  function applyVisionResult(analysis: VisionAnalysis) {
    setDraftBoard(analysis.board);
    setDigitizeNotes({ confidence: analysis.confidence, notes: analysis.notes });

    if (confirmedBoard) {
      const justMoved = inferMover(confirmedBoard, analysis.board);
      if (justMoved) {
        setDraftNextMover(other(justMoved));
        setMoverInferred(true);
      } else {
        setDraftNextMover(other(currentMover));
        setMoverInferred(false);
      }
    } else {
      setDraftNextMover(BLACK);
      setMoverInferred(false);
    }
  }

  async function onPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy("digitize");
    try {
      const captured = await capturedImageFromFile(file);
      const analysis = analyzeBoardImageData(captured);
      applyVisionResult(analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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

  function handleCameraCapture(analysis: VisionAnalysis) {
    setShowCamera(false);
    applyVisionResult(analysis);
  }

  function cycleCell(i: number) {
    if (!draftBoard) return;
    const next = [...draftBoard] as Board;
    next[i] = ((next[i] + 1) % 3) as Board[number];
    setDraftBoard(next);
  }

  async function runEvaluate(board: Board, mover: Player) {
    setError(null);
    setBusy("evaluate");
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, mover, hideBestMoveHint: !showBestMove }),
      });
      const json = await safeJson(res);
      if (!res.ok) {
        throw new Error(`${json.error || "評価に失敗しました。"}${json.requestId ? ` (ID: ${json.requestId})` : ""}`);
      }
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAndEvaluate() {
    if (!draftBoard) return;
    const board = draftBoard;
    const mover = draftNextMover;
    setConfirmedBoard(board);
    setCurrentMover(mover);
    setDraftBoard(null);
    setDigitizeNotes(null);
    await runEvaluate(board, mover);
  }

  // Manual move entry: click a legal-move cell to place `currentMover`'s
  // disc there. The resulting board (flips included) and the next mover
  // (including the Othello pass rule) are both exact — no photo/CV
  // ambiguity — so the move applies immediately and evaluation for the
  // new position runs automatically in the background.
  function handleManualMove(index: number) {
    if (!confirmedBoard) return;
    const newBoard = applyMove(confirmedBoard, currentMover, index);
    const next = nextMoverAfterMove(newBoard, currentMover);
    setConfirmedBoard(newBoard);
    setResult(null);
    if (next === null) return; // game over, nothing to evaluate
    setCurrentMover(next);
    void runEvaluate(newBoard, next);
  }

  const displayBoard = draftBoard ?? confirmedBoard;
  const analysis = result?.analysis;
  const gameOver = confirmedBoard ? isGameOver(confirmedBoard) : false;
  const moveEntryCells =
    !draftBoard && confirmedBoard && !gameOver ? legalMoves(confirmedBoard, currentMover) : [];
  const finalCounts = gameOver && confirmedBoard ? countDiscs(confirmedBoard) : null;

  return (
    <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">オセロ評価AI</h1>
        <p className="text-sm text-neutral-600">
          将棋の指し手評価AIのように、一手ごとに勝率と理由を確認できます。盤面のマスをタップして着手を入力するか、撮影して読み取れます。
        </p>
        <label className="flex items-center gap-2 text-sm text-neutral-700 w-fit">
          <input
            type="checkbox"
            checked={showBestMove}
            onChange={(e) => setShowBestMove(e.target.checked)}
            className="w-4 h-4"
          />
          最善手を表示する
          <span className="text-xs text-neutral-400">(対戦しながら使う場合はオフに)</span>
        </label>
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
          {!draftBoard && confirmedBoard && (
            <div className="flex items-center gap-2">
              {gameOver && finalCounts ? (
                <p className="font-semibold">
                  対局終了: 黒{finalCounts.black} - 白{finalCounts.white}
                  {finalCounts.black === finalCounts.white
                    ? " (引き分け)"
                    : finalCounts.black > finalCounts.white
                      ? " 黒の勝ち"
                      : " 白の勝ち"}
                </p>
              ) : (
                <p className="flex items-center gap-2 font-medium">
                  <span>現在の手番:</span>
                  <DiscIcon color={currentMover} />
                  <span>{playerLabel(currentMover)}</span>
                </p>
              )}
            </div>
          )}

          <BoardGrid
            board={displayBoard}
            editable={!!draftBoard}
            onCellClick={draftBoard ? cycleCell : undefined}
            bestMove={draftBoard || !showBestMove ? undefined : analysis?.best?.move ?? null}
            candidateMoves={
              draftBoard || !showBestMove ? undefined : analysis?.candidates.slice(1, 3).map((c) => c.move)
            }
            legalMoveCells={moveEntryCells}
            onMoveCellClick={handleManualMove}
          />

          {!draftBoard && confirmedBoard && !gameOver && (
            <p className="text-xs text-neutral-500">
              緑の丸が付いたマスをタップすると、{playerLabel(currentMover)}の着手として盤面に反映されます。
            </p>
          )}

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
          {showBestMove && analysis.best && (
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
        </section>
      )}
    </main>
  );
}
