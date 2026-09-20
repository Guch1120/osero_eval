import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { analyzePosition, BLACK, WHITE, type Board, type Player } from "@/lib/othello";
import { explainPosition, type ExplainInput } from "@/lib/gemini";
import { logError, logInfo, logWarn } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

function fallbackExplanation(input: ExplainInput): string {
  const lead =
    input.mode === "exact"
      ? `終盤まで読み切った結果、${input.moverLabel}の手番でこの先最善を尽くすと黒${input.blackWinProbPct}%・白${input.whiteWinProbPct}%という確定的な結果になります。`
      : `簡易評価による概算では、${input.moverLabel}の手番の局面は黒${input.blackWinProbPct}%・白${input.whiteWinProbPct}%です。`;
  const f = input.features;
  const points: string[] = [];
  if (Math.abs(f.cornerDiff) > 0) points.push(`角の獲得数の差は${f.cornerDiff > 0 ? "手番側が有利" : "相手が有利"}(${f.cornerDiff})`);
  if (Math.abs(f.mobilityDiff) > 10) points.push(`着手可能数は${f.mobilityDiff > 0 ? "手番側が優勢" : "相手が優勢"}`);
  if (Math.abs(f.frontierDiff) > 10) points.push(`相手に取られにくい石の割合は${f.frontierDiff > 0 ? "手番側が良好" : "相手が良好"}`);
  const bestPart = input.bestMoveNotation ? ` 最善手の候補は${input.bestMoveNotation}です。` : "";
  return `${lead}${points.length ? points.join("。") + "。" : ""}${bestPart}`;
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let body: { board?: number[]; mover?: number };
  try {
    body = await req.json();
  } catch (err) {
    logError("evaluate", "request body was not valid JSON", err, { requestId });
    return NextResponse.json({ error: "リクエストの形式が不正です。", requestId }, { status: 400 });
  }

  const { board, mover } = body;
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
    bestMoveNotation: analysis.best?.notation ?? null,
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

  let explanation: string;
  let explanationSource: "llm" | "fallback" = "llm";
  try {
    explanation = await explainPosition(explainInput);
    logInfo("evaluate", "explanation generated via LLM", { requestId, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    logError("evaluate", "LLM explanation failed, using fallback text", err, { requestId });
    explanationSource = "fallback";
    explanation = fallbackExplanation(explainInput);
  }

  return NextResponse.json({
    analysis,
    explanation,
    explanationSource,
    requestId,
  });
}
