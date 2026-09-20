// Core Othello (Reversi) rules + search engine.
//
// Design note: the win-probability number shown to the user is computed
// entirely by this deterministic search engine, never by the LLM. The LLM
// is only used (elsewhere) to (a) read the board off a photo and
// (b) turn the numeric features this engine produces into Japanese prose.
// This mirrors how shogi/chess "evaluation AIs" work: a search engine
// supplies the number, a language layer supplies the commentary.

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Cell = 0 | 1 | 2;
export type Player = 1 | 2;
export type Board = Cell[]; // length 64, row-major, index = row*8+col

export function emptyBoard(): Board {
  return new Array(64).fill(EMPTY) as Board;
}

export function initialBoard(): Board {
  const b = emptyBoard();
  b[27] = WHITE; // d4
  b[28] = BLACK; // e4
  b[35] = BLACK; // d5
  b[36] = WHITE; // e5
  return b;
}

export function other(player: Player): Player {
  return player === BLACK ? WHITE : BLACK;
}

export function idx(r: number, c: number): number {
  return r * 8 + c;
}

export function rc(i: number): [number, number] {
  return [Math.floor(i / 8), i % 8];
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

const DIRECTIONS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

// Squares that get flipped if `move` is played by `player`. Empty array
// means the move is illegal.
function flipsForMove(board: Board, player: Player, move: number): number[] {
  if (board[move] !== EMPTY) return [];
  const opp = other(player);
  const [r0, c0] = rc(move);
  const flips: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    let r = r0 + dr;
    let c = c0 + dc;
    const line: number[] = [];
    while (inBounds(r, c) && board[idx(r, c)] === opp) {
      line.push(idx(r, c));
      r += dr;
      c += dc;
    }
    if (line.length > 0 && inBounds(r, c) && board[idx(r, c)] === player) {
      flips.push(...line);
    }
  }
  return flips;
}

export function isLegalMove(board: Board, player: Player, move: number): boolean {
  return flipsForMove(board, player, move).length > 0;
}

export function legalMoves(board: Board, player: Player): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (board[i] === EMPTY && flipsForMove(board, player, i).length > 0) {
      moves.push(i);
    }
  }
  return moves;
}

export function applyMove(board: Board, player: Player, move: number): Board {
  const flips = flipsForMove(board, player, move);
  if (flips.length === 0) {
    throw new Error(`illegal move ${move} for player ${player}`);
  }
  const next = board.slice() as Board;
  next[move] = player;
  for (const f of flips) next[f] = player;
  return next;
}

export function countDiscs(board: Board): { black: number; white: number; empty: number } {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (const c of board) {
    if (c === BLACK) black++;
    else if (c === WHITE) white++;
    else empty++;
  }
  return { black, white, empty };
}

export function isGameOver(board: Board): boolean {
  return legalMoves(board, BLACK).length === 0 && legalMoves(board, WHITE).length === 0;
}

// Who moves next after `moverJustPlayed` plays, applying the standard
// Othello pass rule: if the opponent has no legal move, turn returns to
// the same player; if neither does, the game is over (null).
export function nextMoverAfterMove(board: Board, moverJustPlayed: Player): Player | null {
  const opp = other(moverJustPlayed);
  if (legalMoves(board, opp).length > 0) return opp;
  if (legalMoves(board, moverJustPlayed).length > 0) return moverJustPlayed;
  return null;
}

export function moveToNotation(move: number): string {
  const [r, c] = rc(move);
  return `${"abcdefgh"[c]}${r + 1}`;
}

// ---------------------------------------------------------------------
// Static positional weights (classic Othello table). Corner-adjacent
// "danger" squares are neutralised once the corresponding corner is
// already occupied, since the risk that motivates the negative weight
// (opponent grabbing the corner) no longer exists.
// ---------------------------------------------------------------------

const STATIC_WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

const CORNER_RISK_GROUPS: Array<{ corner: number; risky: number[] }> = [
  { corner: 0, risky: [1, 8, 9] },
  { corner: 7, risky: [6, 14, 15] },
  { corner: 56, risky: [48, 49, 57] },
  { corner: 63, risky: [55, 54, 62] },
];

function dynamicWeight(board: Board, i: number): number {
  for (const g of CORNER_RISK_GROUPS) {
    if (g.risky.includes(i) && board[g.corner] !== EMPTY) return 5;
  }
  return STATIC_WEIGHTS[i];
}

function frontierCount(board: Board, player: Player): number {
  let count = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] !== player) continue;
    const [r, c] = rc(i);
    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[idx(nr, nc)] === EMPTY) {
        count++;
        break;
      }
    }
  }
  return count;
}

export interface EvalFeatures {
  positional: number; // raw positional-table diff, player - opponent
  mobilityDiff: number; // -100..100
  frontierDiff: number; // -100..100 (positive = player has fewer exposed discs)
  discDiff: number; // -100..100
  cornerDiff: number; // -4..4, corners owned by player minus opponent
}

const CORNERS = [0, 7, 56, 63];

export function computeFeatures(board: Board, player: Player): EvalFeatures {
  const opp = other(player);
  let positional = 0;
  for (let i = 0; i < 64; i++) {
    const c = board[i];
    if (c === EMPTY) continue;
    const w = dynamicWeight(board, i);
    positional += c === player ? w : -w;
  }

  const playerMoves = legalMoves(board, player).length;
  const oppMoves = legalMoves(board, opp).length;
  const mobilityDiff =
    playerMoves + oppMoves > 0 ? (100 * (playerMoves - oppMoves)) / (playerMoves + oppMoves) : 0;

  const playerFrontier = frontierCount(board, player);
  const oppFrontier = frontierCount(board, opp);
  const frontierDiff =
    playerFrontier + oppFrontier > 0
      ? (100 * (oppFrontier - playerFrontier)) / (playerFrontier + oppFrontier)
      : 0;

  const { black, white } = countDiscs(board);
  const playerDiscs = player === BLACK ? black : white;
  const oppDiscs = player === BLACK ? white : black;
  const discDiff =
    playerDiscs + oppDiscs > 0 ? (100 * (playerDiscs - oppDiscs)) / (playerDiscs + oppDiscs) : 0;

  let playerCorners = 0;
  let oppCorners = 0;
  for (const c of CORNERS) {
    if (board[c] === player) playerCorners++;
    else if (board[c] === opp) oppCorners++;
  }

  return { positional, mobilityDiff, frontierDiff, discDiff, cornerDiff: playerCorners - oppCorners };
}

function evaluateHeuristic(board: Board, player: Player): number {
  const f = computeFeatures(board, player);
  const emptyCnt = countDiscs(board).empty;
  const progress = (64 - emptyCnt) / 64; // 0 at start, 1 near the end

  const wPositional = 0.1;
  const wMobility = 3.0 * (1 - progress) + 0.5 * progress;
  const wFrontier = 2.0 * (1 - progress);
  const wDisc = 0.2 + 1.5 * progress;

  return (
    wPositional * f.positional +
    wMobility * f.mobilityDiff +
    wFrontier * f.frontierDiff +
    wDisc * f.discDiff
  );
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

class SearchBudgetExceeded extends Error {}

interface SearchCtx {
  deadline: number; // Date.now() ms
  nodes: number;
  nodeLimit: number;
}

function checkBudget(ctx: SearchCtx) {
  ctx.nodes++;
  if (ctx.nodes % 2048 === 0) {
    if (Date.now() > ctx.deadline || ctx.nodes > ctx.nodeLimit) {
      throw new SearchBudgetExceeded();
    }
  }
}

// Fixed-depth negamax with alpha-beta, used away from the endgame.
// Returns a heuristic score from `player`'s perspective.
function negamaxHeuristic(
  board: Board,
  player: Player,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx
): number {
  checkBudget(ctx);
  const moves = legalMoves(board, player);
  if (moves.length === 0) {
    const oppMoves = legalMoves(board, other(player));
    if (oppMoves.length === 0) {
      const { black, white } = countDiscs(board);
      const diff = player === BLACK ? black - white : white - black;
      return diff * 100; // decisive terminal, scaled to dominate heuristics
    }
    return -negamaxHeuristic(board, other(player), depth, -beta, -alpha, ctx);
  }
  if (depth === 0) {
    return evaluateHeuristic(board, player);
  }

  // Simple move ordering: try higher static-weight squares first.
  const ordered = moves
    .slice()
    .sort((a, b) => dynamicWeight(board, b) - dynamicWeight(board, a));

  let best = -Infinity;
  for (const m of ordered) {
    const nb = applyMove(board, player, m);
    const val = -negamaxHeuristic(nb, other(player), depth - 1, -beta, -alpha, ctx);
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

// Exact search to the end of the game (used only near the endgame, where
// the empty-square count is small enough to be tractable). Returns the
// exact final disc difference from `player`'s perspective under optimal
// play by both sides, PROVIDED the node/time budget is not exceeded.
function negamaxExact(
  board: Board,
  player: Player,
  alpha: number,
  beta: number,
  ctx: SearchCtx
): number {
  checkBudget(ctx);
  const moves = legalMoves(board, player);
  if (moves.length === 0) {
    const oppMoves = legalMoves(board, other(player));
    if (oppMoves.length === 0) {
      const { black, white } = countDiscs(board);
      return player === BLACK ? black - white : white - black;
    }
    return -negamaxExact(board, other(player), -beta, -alpha, ctx);
  }

  const ordered = moves
    .slice()
    .sort((a, b) => dynamicWeight(board, b) - dynamicWeight(board, a));

  let best = -Infinity;
  for (const m of ordered) {
    const nb = applyMove(board, player, m);
    const val = -negamaxExact(nb, other(player), -beta, -alpha, ctx);
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

const EXACT_EMPTY_THRESHOLD = 10;
const EXACT_NODE_LIMIT = 6_000_000;
const EXACT_TIME_BUDGET_MS = 4000;
const HEURISTIC_NODE_LIMIT = 3_000_000;
const HEURISTIC_TIME_BUDGET_MS = 2500;

export interface MoveCandidate {
  move: number;
  notation: string;
  // Score from the mover's perspective. For exact analysis this is the
  // final disc-count difference under optimal play; for heuristic
  // analysis it is an arbitrary-scale positional score.
  score: number;
}

export interface PositionAnalysis {
  mover: Player;
  mode: "exact" | "heuristic";
  emptyCount: number;
  candidates: MoveCandidate[]; // sorted best-first
  best: MoveCandidate | null;
  features: EvalFeatures; // features of the position before the mover moves
  moverWinProb: number; // 0..1, probability the mover goes on to win
  blackWinProb: number; // 0..1
  whiteWinProb: number; // 0..1
  drawish: boolean; // exact mode found a dead-even result
  searchDepth: number | null; // heuristic mode only
  degradedToHeuristic: boolean; // exact search hit its budget and fell back
}

function sigmoid(x: number, k: number): number {
  return 1 / (1 + Math.exp(-x / k));
}

function pickHeuristicDepth(emptyCount: number): number {
  if (emptyCount > 44) return 5;
  if (emptyCount > 28) return 6;
  if (emptyCount > 16) return 7;
  return 8;
}

export function analyzePosition(board: Board, mover: Player): PositionAnalysis {
  const emptyCount = countDiscs(board).empty;
  const moves = legalMoves(board, mover);
  const features = computeFeatures(board, mover);

  if (moves.length === 0) {
    // Mover has no legal move (must pass, or the game is over). The
    // caller is expected to detect game-over separately; here we just
    // report a neutral analysis with no candidates.
    const stuck: PositionAnalysis = {
      mover,
      mode: "heuristic",
      emptyCount,
      candidates: [],
      best: null,
      features,
      moverWinProb: 0.5,
      blackWinProb: 0.5,
      whiteWinProb: 0.5,
      drawish: false,
      searchDepth: null,
      degradedToHeuristic: false,
    };
    return stuck;
  }

  const wantExact = emptyCount <= EXACT_EMPTY_THRESHOLD;
  let mode: "exact" | "heuristic" = wantExact ? "exact" : "heuristic";
  let degradedToHeuristic = false;

  const candidates: MoveCandidate[] = [];

  if (wantExact) {
    const ctx: SearchCtx = {
      deadline: Date.now() + EXACT_TIME_BUDGET_MS,
      nodes: 0,
      nodeLimit: EXACT_NODE_LIMIT,
    };
    try {
      for (const m of moves) {
        const nb = applyMove(board, mover, m);
        const score = -negamaxExact(nb, other(mover), -Infinity, Infinity, ctx);
        candidates.push({ move: m, notation: moveToNotation(m), score });
      }
    } catch (e) {
      if (e instanceof SearchBudgetExceeded) {
        degradedToHeuristic = true;
        mode = "heuristic";
        candidates.length = 0;
      } else {
        throw e;
      }
    }
  }

  let searchDepth: number | null = null;
  if (mode === "heuristic") {
    const depth = pickHeuristicDepth(emptyCount);
    searchDepth = depth;
    const ctx: SearchCtx = {
      deadline: Date.now() + HEURISTIC_TIME_BUDGET_MS,
      nodes: 0,
      nodeLimit: HEURISTIC_NODE_LIMIT,
    };
    for (const m of moves) {
      const nb = applyMove(board, mover, m);
      let score: number;
      try {
        score = -negamaxHeuristic(nb, other(mover), depth - 1, -Infinity, Infinity, ctx);
      } catch (e) {
        if (e instanceof SearchBudgetExceeded) {
          score = evaluateHeuristic(nb, mover);
        } else {
          throw e;
        }
      }
      candidates.push({ move: m, notation: moveToNotation(m), score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;

  let moverWinProb: number;
  let drawish = false;
  if (mode === "exact" && best) {
    if (best.score > 0) moverWinProb = 1;
    else if (best.score < 0) moverWinProb = 0;
    else {
      moverWinProb = 0.5;
      drawish = true;
    }
  } else if (best) {
    moverWinProb = sigmoid(best.score, 180);
  } else {
    moverWinProb = 0.5;
  }

  const blackWinProb = mover === BLACK ? moverWinProb : 1 - moverWinProb;
  const whiteWinProb = 1 - blackWinProb;

  return {
    mover,
    mode,
    emptyCount,
    candidates,
    best,
    features,
    moverWinProb,
    blackWinProb,
    whiteWinProb,
    drawish,
    searchDepth,
    degradedToHeuristic,
  };
}

// ---------------------------------------------------------------------
// Helpers for turn inference: given the previous digitized board and the
// newly digitized one, figure out which color just moved (the color
// whose disc count went up — its own new disc plus any flips).
// ---------------------------------------------------------------------

export function inferMover(prevBoard: Board, nextBoard: Board): Player | null {
  const prev = countDiscs(prevBoard);
  const next = countDiscs(nextBoard);
  const blackDelta = next.black - prev.black;
  const whiteDelta = next.white - prev.white;
  if (blackDelta > 0 && whiteDelta <= 0) return BLACK;
  if (whiteDelta > 0 && blackDelta <= 0) return WHITE;
  return null; // ambiguous / inconsistent photo, let the caller ask the user
}
