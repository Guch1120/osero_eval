// Rule-based Japanese commentary generator. Turns the search engine's
// already-computed numbers into a short natural-language explanation —
// deterministically, with no external API call. This used to be only a
// fallback for when the LLM explanation call failed; it's now the only
// explanation path (see the "why no LLM" note in lib/boardVision.ts for
// the reasoning — board digitization and commentary were the app's only
// two LLM dependencies, and both turned out to be unnecessary given the
// search engine already has all the numbers commentary needs).

export interface ExplainInput {
  moverLabel: string; // "黒" | "白"
  blackWinProbPct: number;
  whiteWinProbPct: number;
  mode: "exact" | "heuristic";
  bestMoveNotation: string | null;
  topCandidates: Array<{ notation: string; score: number }>;
  features: {
    mobilityDiff: number;
    frontierDiff: number;
    discDiff: number;
    cornerDiff: number;
  };
  emptyCount: number;
  drawish: boolean;
}

export function buildExplanation(input: ExplainInput): string {
  const lead =
    input.mode === "exact"
      ? `終盤まで読み切った結果、${input.moverLabel}の手番でこの先最善を尽くすと黒${input.blackWinProbPct}%・白${input.whiteWinProbPct}%という確定的な結果になります。`
      : `簡易評価による概算では、${input.moverLabel}の手番の局面は黒${input.blackWinProbPct}%・白${input.whiteWinProbPct}%です。`;
  const f = input.features;
  const points: string[] = [];
  if (Math.abs(f.cornerDiff) > 0) {
    points.push(`角の獲得数の差は${f.cornerDiff > 0 ? "手番側が有利" : "相手が有利"}(${f.cornerDiff})`);
  }
  if (Math.abs(f.mobilityDiff) > 10) {
    points.push(`着手可能数は${f.mobilityDiff > 0 ? "手番側が優勢" : "相手が優勢"}`);
  }
  if (Math.abs(f.frontierDiff) > 10) {
    points.push(`相手に取られにくい石の割合は${f.frontierDiff > 0 ? "手番側が良好" : "相手が良好"}`);
  }
  const bestPart = input.bestMoveNotation ? ` 最善手の候補は${input.bestMoveNotation}です。` : "";
  return `${lead}${points.length ? points.join("。") + "。" : ""}${bestPart}`;
}
