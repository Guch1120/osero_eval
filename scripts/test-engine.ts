// Quick sanity check for the Othello engine, independent of any LLM call.
// Run with: npm run test:engine

import {
  BLACK,
  WHITE,
  type Board,
  type Player,
  initialBoard,
  isGameOver,
  legalMoves,
  applyMove,
  analyzePosition,
  countDiscs,
  inferMover,
  moveToNotation,
  nextMoverAfterMove,
  other,
} from "../lib/othello";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

const board = initialBoard();
const moves = legalMoves(board, BLACK);
assert(moves.length === 4, `initial position has 4 legal moves for black (got ${moves.length})`);
assert(
  moves.map(moveToNotation).sort().join(",") === "c4,d3,e6,f5",
  `initial legal moves are the expected 4 squares (got ${moves.map(moveToNotation).join(",")})`
);

const afterFirstMove = applyMove(board, BLACK, moves[0]);
const discs = countDiscs(afterFirstMove);
assert(discs.black + discs.white === 5, "one move places one disc plus flips (5 total discs)");

const mover = inferMover(board, afterFirstMove);
assert(mover === BLACK, `inferMover correctly detects black just moved (got ${mover})`);

assert(
  nextMoverAfterMove(afterFirstMove, BLACK) === WHITE,
  "nextMoverAfterMove hands the turn to the opponent when they have a legal move"
);

const analysis = analyzePosition(afterFirstMove, WHITE);
assert(analysis.candidates.length > 0, "analyzePosition finds candidate moves for white");
assert(
  analysis.blackWinProb >= 0 && analysis.blackWinProb <= 1,
  `blackWinProb is a probability (got ${analysis.blackWinProb})`
);
assert(
  Math.abs(analysis.blackWinProb + analysis.whiteWinProb - 1) < 1e-9,
  "black/white win probabilities sum to 1"
);
assert(analysis.mode === "heuristic", `midgame analysis uses heuristic mode (got ${analysis.mode})`);

// A trivial near-endgame-style sanity check: a board with very few empty
// squares should trigger exact solving.
console.log(`Sample analysis: mode=${analysis.mode} best=${analysis.best?.notation} blackWinProb=${analysis.blackWinProb.toFixed(3)}`);

// Play a random game down to <=10 empty squares and confirm the engine
// switches to exact endgame solving, and that the result is fully
// decisive (win prob 0, 0.5, or 1) as it should be for an exact solve.
function randomSelfPlayToEndgame(): { board: Board; mover: Player } | null {
  let b = initialBoard();
  let p: Player = BLACK;
  let guard = 0;
  while (countDiscs(b).empty > 10 && guard < 200) {
    guard++;
    const moves = legalMoves(b, p);
    if (moves.length === 0) {
      const oppMoves = legalMoves(b, other(p));
      if (oppMoves.length === 0) return null; // game ended early
      p = other(p);
      continue;
    }
    const m = moves[Math.floor(Math.random() * moves.length)];
    b = applyMove(b, p, m);
    p = other(p);
  }
  if (countDiscs(b).empty > 10) return null;
  return { board: b, mover: p };
}

const endgame = randomSelfPlayToEndgame();
if (endgame) {
  const endAnalysis = analyzePosition(endgame.board, endgame.mover);
  assert(endAnalysis.mode === "exact", `endgame position (<=10 empty) triggers exact solve (got ${endAnalysis.mode})`);
  assert(
    endAnalysis.moverWinProb === 0 || endAnalysis.moverWinProb === 0.5 || endAnalysis.moverWinProb === 1,
    `exact solve gives a decisive win probability (got ${endAnalysis.moverWinProb})`
  );
  console.log(
    `Endgame sample: empties=${endAnalysis.emptyCount} mode=${endAnalysis.mode} moverWinProb=${endAnalysis.moverWinProb} degraded=${endAnalysis.degradedToHeuristic}`
  );
} else {
  console.log("Endgame sample: game ended before reaching 10 empty squares (skipped)");
}

// Play a full random game to actual completion using nextMoverAfterMove
// itself to drive turn order (including passes), and confirm it always
// terminates in a real game-over state with all 64 squares filled or no
// moves left for either side, and returns null exactly there.
{
  let b = initialBoard();
  let p: Player = BLACK;
  let sawAPass = false;
  let guard = 0;
  let prevP: Player = p;
  while (!isGameOver(b) && guard < 200) {
    guard++;
    const moves = legalMoves(b, p);
    const m = moves[Math.floor(Math.random() * moves.length)];
    b = applyMove(b, p, m);
    const next = nextMoverAfterMove(b, p);
    if (next === p) sawAPass = true;
    prevP = p;
    p = next ?? p; // if game just ended, next is null; loop condition will exit
    if (next === null) break;
  }
  assert(isGameOver(b), `full random self-play reaches a true game-over state (guard=${guard})`);
  assert(nextMoverAfterMove(b, prevP) === null, "nextMoverAfterMove returns null once the game is actually over");
  const finalCounts = countDiscs(b);
  assert(finalCounts.black + finalCounts.white + finalCounts.empty === 64, "final board still has exactly 64 squares");
  console.log(
    `Full game sample: guard=${guard} black=${finalCounts.black} white=${finalCounts.white} empty=${finalCounts.empty} sawAPass=${sawAPass}`
  );
}

if (process.exitCode) {
  console.error("\nEngine self-test FAILED");
} else {
  console.log("\nEngine self-test passed");
}
