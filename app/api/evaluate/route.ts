import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { analyzePosition, BLACK, WHITE, type Board, type Player } from "@/lib/othello";
import { buildExplanation, type ExplainInput } from "@/lib/explain";
import { logInfo, logWarn } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 15; // engine search alone is bounded to a few seconds; no external API calls here anymore

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let body: { board?: number[]; mover?: number; hideBestMoveHint?: boolean };
  try {
    body = await req.json();
  } catch (err) {
    logWarn("evaluate", "request body was not valid JSON", { requestId });
    return NextResponse.json({ error: "リクエストの形式が不正です。", requestId }, { status: 400 });
  }

  const { board, mover, hideBestMoveHint } = body;
  if (!Array.isArray(board) || board.length !== 64 || (mover !== 1 && mover !== 2)) {
    logWarn("evaluate", "invalid board/mover in request", { requestId, boardLength: board?.length, mover });
    return NextResponse.json(
      { error: "board(64マス)と mover(1=黒 or 2=白)が必要です。", requestId },
      { status: 400 }
    );
  }
  if (board.some((c) => c !== 0 && c !== 1 && c !== 2)) {
    logWarn("evaluate", "board contains invalid cell values", { requestId });
    return NextResponse.json(
      { error: "board の値は 0(空), 1(黒), 2(白) のいずれかである必要があります。", requestId },
      { status: 400 }
    );
  }

  logInfo("evaluate", "request received", { requestId, mover });

  const analysis = analyzePosition(board as Board, mover as Player);
  logInfo("evaluate", "analysis complete", {
    requestId,
    mode: analysis.mode,
    emptyCount: analysis.emptyCount,
    degradedToHeuristic: analysis.degradedToHeuristic,
    elapsedMs: Date.now() - startedAt,
  });

  const moverLabel = mover === BLACK ? "黒" : "白";
  const explainInput: ExplainInput = {
    moverLabel,
    blackWinProbPct: Math.round(analysis.blackWinProb * 1000) / 10,
    whiteWinProbPct: Math.round(analysis.whiteWinProb * 1000) / 10,
    mode: analysis.mode,
    // When the app is being used side-by-side during a live game, the
    // user may want the win% and general commentary without the prose
    // literally naming the best move — the board's own best-move highlight
    // is suppressed client-side in that mode, so keep the text consistent.
    bestMoveNotation: hideBestMoveHint ? null : analysis.best?.notation ?? null,
    topCandidates: analysis.candidates.slice(0, 3).map((c) => ({ notation: c.notation, score: c.score })),
    features: {
      mobilityDiff: Math.round(analysis.features.mobilityDiff),
      frontierDiff: Math.round(analysis.features.frontierDiff),
      discDiff: Math.round(analysis.features.discDiff),
      cornerDiff: analysis.features.cornerDiff,
    },
    emptyCount: analysis.emptyCount,
    drawish: analysis.drawish,
  };

  const explanation = buildExplanation(explainInput);

  return NextResponse.json({
    analysis,
    explanation,
    requestId,
  });
}
