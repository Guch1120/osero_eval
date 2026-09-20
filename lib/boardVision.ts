// Classical (non-LLM) computer vision for reading an Othello board off a
// photo. Deliberately dependency-free and DOM-free (operates on raw pixel
// data), so it runs identically in the browser and under plain Node for
// testing (see scripts/test-vision.ts).
//
// Why not an LLM: board digitization was previously done by a multimodal
// LLM (Gemma/Gemini), but that dependency turned out to be the single
// biggest source of trouble in this app — model retirements, capacity
// 503s, and timeouts, even with a 3-tier fallback chain and retries. Since
// the capture UI already guides the user to frame the board tightly in a
// square, the CV problem is tractable: find the 9x9 grid of lines within
// that square, then classify each of the 64 cells by how dark or light it
// is relative to the others in the same photo.
//
// This is a heuristic, not a robust vision pipeline — it assumes:
//   - the board roughly fills the captured square (the capture guide's job)
//   - grid lines are darker than the board surface
//   - black discs are darker, white discs are lighter, than the board
// It will misread some photos (glare, low contrast, heavy misalignment).
// The app always shows a tap-to-correct grid editor after digitizing for
// exactly this reason — treat this as "usually close", not "always right".

import { BLACK, EMPTY, WHITE, type Board, type Cell } from "./othello";

export interface PixelBuffer {
  data: ArrayLike<number>; // RGBA, length === width*height*4
  width: number;
  height: number;
}

export interface VisionAnalysis {
  board: Board;
  confidence: number; // 0-1, heuristic
  notes: string; // Japanese, empty if nothing noteworthy
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function toLuminance(px: PixelBuffer): Float32Array {
  const { data, width, height } = px;
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return lum;
}

function rowDarkness(L: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) sum += 255 - L[base + x];
    out[y] = sum / w;
  }
  return out;
}

function colDarkness(L: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) sum += 255 - L[y * w + x];
    out[x] = sum / h;
  }
  return out;
}

// Starts from a naive evenly-spaced 9-line grid (assuming the board fills
// the frame exactly) and snaps each line to the darkest row/column within
// a search window around its expected position — this is what tolerates
// the board not perfectly filling the capture guide. Falls back to the
// naive uniform grid if snapping produces a degenerate (non-monotonic or
// too-thin) result, which is safer than a garbled grid.
function snapLines(darkness: Float32Array, size: number): number[] {
  const cell = size / 8;
  const margin = cell * 0.35;
  const naive = Array.from({ length: 9 }, (_, i) => Math.round(i * cell));

  const lines: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const expected = naive[i];
    const winLo = Math.max(0, Math.round(expected - margin));
    const winHi = Math.min(size - 1, Math.round(expected + margin));
    let best = expected;
    let bestVal = -Infinity;
    for (let p = winLo; p <= winHi; p++) {
      if (darkness[p] > bestVal) {
        bestVal = darkness[p];
        best = p;
      }
    }
    lines.push(best);
  }

  const minGap = cell * 0.5;
  for (let i = 1; i <= 8; i++) {
    if (lines[i] <= lines[i - 1] + minGap) return naive;
  }
  return lines;
}

export function analyzeBoardImageData(px: PixelBuffer): VisionAnalysis {
  const { width: w, height: h } = px;
  const rawLum = toLuminance(px);
  // No global contrast stretching: both grid detection (darkest line in a
  // local window) and cell classification (thresholds derived from this
  // photo's own min/max cell brightness, below) are already relative to
  // this image, not absolute. Stretching by global percentile turned out
  // to actively hurt: when the board surface is a large, nearly uniform
  // area (typical), the 2nd-98th percentile of the whole image can land
  // entirely within that uniform region, collapsing grid lines and discs
  // into the same extreme value and destroying the signal we need.
  const rowLines = snapLines(rowDarkness(rawLum, w, h), h); // 9 y-positions
  const colLines = snapLines(colDarkness(rawLum, w, h), w); // 9 x-positions

  // Sample the central 50% of each cell (avoids grid lines and neighboring
  // disc bleed at cell edges) and average its luminance.
  const cellLum = new Array<number>(64);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const y0 = rowLines[r];
      const y1 = rowLines[r + 1];
      const x0 = colLines[c];
      const x1 = colLines[c + 1];
      const cy0 = Math.round(y0 + (y1 - y0) * 0.25);
      const cy1 = Math.round(y0 + (y1 - y0) * 0.75);
      const cx0 = Math.round(x0 + (x1 - x0) * 0.25);
      const cx1 = Math.round(x0 + (x1 - x0) * 0.75);

      let sum = 0;
      let count = 0;
      for (let y = cy0; y < cy1; y++) {
        const base = y * w;
        for (let x = cx0; x < cx1; x++) {
          sum += rawLum[base + x];
          count++;
        }
      }
      cellLum[r * 8 + c] = count > 0 ? sum / count : 128;
    }
  }

  const minL = Math.min(...cellLum);
  const maxL = Math.max(...cellLum);
  const contrastRange = maxL - minL;
  const darkThreshold = minL + contrastRange * 0.33;
  const lightThreshold = minL + contrastRange * 0.66;

  const board: Board = new Array(64).fill(EMPTY) as Board;
  let blackCount = 0;
  let whiteCount = 0;
  const LOW_CONTRAST_CUTOFF = 15; // stretched-luminance units; below this, don't trust any classification

  if (contrastRange > LOW_CONTRAST_CUTOFF) {
    for (let i = 0; i < 64; i++) {
      const v = cellLum[i];
      let cell: Cell = EMPTY;
      if (v <= darkThreshold) {
        cell = BLACK;
        blackCount++;
      } else if (v >= lightThreshold) {
        cell = WHITE;
        whiteCount++;
      }
      board[i] = cell;
    }
  }

  const contrastScore = clamp(contrastRange / 120, 0, 1);
  const bothColorsSeen = blackCount > 0 && whiteCount > 0;
  const confidence = clamp(0.35 + 0.5 * contrastScore + (bothColorsSeen ? 0.15 : 0), 0, 0.95);

  const notes: string[] = [];
  if (contrastRange <= LOW_CONTRAST_CUTOFF) {
    notes.push("盤面のコントラストが低く、石を検出できませんでした");
  } else if (!bothColorsSeen) {
    notes.push("黒石または白石のどちらかが検出されませんでした");
  }

  return { board, confidence, notes: notes.join("。") };
}
