// Synthetic-image tests for the classical CV board reader. Since it's
// DOM-free by design, we can construct fake pixel buffers by hand here and
// run it under plain Node — no canvas, no browser, no LLM.
//
// Run with: npm run test:vision

import { analyzeBoardImageData, type PixelBuffer } from "../lib/boardVision";
import { BLACK, EMPTY, WHITE, initialBoard, type Board } from "../lib/othello";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

function setPixel(buf: Uint8ClampedArray, w: number, x: number, y: number, r: number, g: number, b: number) {
  const p = (y * w + x) * 4;
  buf[p] = r;
  buf[p + 1] = g;
  buf[p + 2] = b;
  buf[p + 3] = 255;
}

interface SynthOptions {
  frameSize: number; // total image side length
  boardOffset: number; // px inset of the board within the frame (0 = board fills frame)
  boardSize: number; // px side length of the board itself
  board: Board;
  bg?: [number, number, number];
  boardColor?: [number, number, number];
  gridColor?: [number, number, number];
  blackColor?: [number, number, number];
  whiteColor?: [number, number, number];
}

function synthesizeBoardImage(opts: SynthOptions): PixelBuffer {
  const {
    frameSize,
    boardOffset,
    boardSize,
    board,
    bg = [90, 60, 30],
    boardColor = [30, 120, 60],
    gridColor = [15, 15, 15],
    blackColor = [8, 8, 8],
    whiteColor = [240, 240, 235],
  } = opts;

  const data = new Uint8ClampedArray(frameSize * frameSize * 4);
  for (let y = 0; y < frameSize; y++) {
    for (let x = 0; x < frameSize; x++) setPixel(data, frameSize, x, y, ...bg);
  }
  for (let y = boardOffset; y < boardOffset + boardSize; y++) {
    for (let x = boardOffset; x < boardOffset + boardSize; x++) {
      setPixel(data, frameSize, x, y, ...boardColor);
    }
  }

  const cell = boardSize / 8;
  const lineThickness = Math.max(2, Math.round(cell * 0.05));
  for (let i = 0; i <= 8; i++) {
    const pos = Math.round(boardOffset + i * cell);
    for (let t = -Math.floor(lineThickness / 2); t <= Math.floor(lineThickness / 2); t++) {
      const yLine = pos + t;
      if (yLine >= 0 && yLine < frameSize) {
        for (let x = boardOffset; x < boardOffset + boardSize; x++) setPixel(data, frameSize, x, yLine, ...gridColor);
      }
      const xLine = pos + t;
      if (xLine >= 0 && xLine < frameSize) {
        for (let y = boardOffset; y < boardOffset + boardSize; y++) setPixel(data, frameSize, xLine, y, ...gridColor);
      }
    }
  }

  const radius = cell * 0.35;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cellVal = board[r * 8 + c];
      if (cellVal === EMPTY) continue;
      const color = cellVal === BLACK ? blackColor : whiteColor;
      const cx = boardOffset + (c + 0.5) * cell;
      const cy = boardOffset + (r + 0.5) * cell;
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(frameSize - 1, Math.ceil(cx + radius));
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(frameSize - 1, Math.ceil(cy + radius));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) setPixel(data, frameSize, x, y, ...color);
        }
      }
    }
  }

  return { data, width: frameSize, height: frameSize };
}

function boardsEqual(a: Board, b: Board): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Test 1: board fills the frame exactly, initial position.
{
  const board = initialBoard();
  const img = synthesizeBoardImage({ frameSize: 320, boardOffset: 0, boardSize: 320, board });
  const result = analyzeBoardImageData(img);
  assert(boardsEqual(result.board, board), "exact-fit frame: reads back the initial position correctly");
  assert(result.confidence > 0.5, `exact-fit frame: reasonable confidence (got ${result.confidence.toFixed(2)})`);
}

// Test 2: board has a small margin within the frame (imperfect guide
// alignment) — this is exactly the scenario the user flagged as likely in
// practice ("completely matching the guide" isn't guaranteed).
{
  const board = initialBoard();
  const boardSize = 320;
  const boardOffset = 10; // symmetric margin on every side, within the snap search window
  const frameSize = boardSize + 2 * boardOffset;
  const img = synthesizeBoardImage({ frameSize, boardOffset, boardSize, board });
  const result = analyzeBoardImageData(img);
  assert(boardsEqual(result.board, board), "slightly misaligned frame (10px margin on all sides): still reads back correctly");
}

// Test 3: a mid-game-ish position with more stones on the board.
{
  const board = initialBoard();
  board[26] = BLACK; // c4
  board[19] = WHITE; // d3 (won't be legal in a real game with this exact combo, doesn't matter for pixel-reading test)
  board[37] = BLACK; // f5
  const img = synthesizeBoardImage({ frameSize: 320, boardOffset: 0, boardSize: 320, board });
  const result = analyzeBoardImageData(img);
  assert(boardsEqual(result.board, board), "mid-game-style position with extra stones reads back correctly");
}

// Test 4: a low-contrast (blank/unreadable) photo should not hallucinate stones.
{
  const frameSize = 320;
  const data = new Uint8ClampedArray(frameSize * frameSize * 4);
  for (let i = 0; i < data.length; i += 4) {
    setPixel(data, frameSize, (i / 4) % frameSize, Math.floor(i / 4 / frameSize), 100, 100, 100);
  }
  const result = analyzeBoardImageData({ data, width: frameSize, height: frameSize });
  const emptyCount = result.board.filter((c) => c === EMPTY).length;
  assert(emptyCount === 64, `flat/low-contrast image is read as all-empty rather than hallucinating stones (got ${64 - emptyCount} non-empty)`);
  assert(result.notes.length > 0, "low-contrast image gets a warning note");
}

if (process.exitCode) {
  console.error("\nVision self-test FAILED");
} else {
  console.log("\nVision self-test passed");
}
