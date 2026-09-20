"use client";

import { BLACK, EMPTY, WHITE, type Board } from "@/lib/othello";

interface Props {
  board: Board;
  editable?: boolean; // raw tap-to-cycle correction mode (photo review)
  onCellClick?: (index: number) => void; // used with `editable`
  bestMove?: number | null;
  candidateMoves?: number[];
  legalMoveCells?: number[]; // move-entry mode: only these cells are clickable
  onMoveCellClick?: (index: number) => void; // used with `legalMoveCells`
}

// Matches lib/othello.ts's moveToNotation ("abcdefgh"[c] + (r+1)), so a
// notation like "f4" from the win% explanation can be found on the board
// by eye instead of having to count squares.
const COLUMN_LABELS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ROW_LABELS = [1, 2, 3, 4, 5, 6, 7, 8];

const CELL_SIZE = "w-9 h-9 sm:w-10 sm:h-10";
const ROW_LABEL_WIDTH = "w-5 sm:w-6";
const LABEL_TEXT = "flex items-center justify-center text-[10px] sm:text-xs text-neutral-500 font-mono";

export default function BoardGrid({
  board,
  editable,
  onCellClick,
  bestMove,
  candidateMoves,
  legalMoveCells,
  onMoveCellClick,
}: Props) {
  return (
    <div className="inline-block select-none">
      <div className="flex">
        <div className={ROW_LABEL_WIDTH} />
        <div className="flex gap-[2px] px-[2px]">
          {COLUMN_LABELS.map((label) => (
            <div key={label} className={`w-9 sm:w-10 ${LABEL_TEXT}`}>
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="flex">
        <div className="flex flex-col gap-[2px] py-[2px]">
          {ROW_LABELS.map((label) => (
            <div key={label} className={`${ROW_LABEL_WIDTH} h-9 sm:h-10 ${LABEL_TEXT}`}>
              {label}
            </div>
          ))}
        </div>
        <div className="inline-grid grid-cols-8 gap-[2px] bg-emerald-950 p-[2px] rounded-md">
          {board.map((cell, i) => {
            const isBest = bestMove === i;
            const isCandidate = !isBest && candidateMoves?.includes(i);
            const isLegalMoveCell = !editable && legalMoveCells?.includes(i);
            const clickable = editable || isLegalMoveCell;

            function handleClick() {
              if (editable) onCellClick?.(i);
              else if (isLegalMoveCell) onMoveCellClick?.(i);
            }

            return (
              <button
                key={i}
                type="button"
                disabled={!clickable}
                onClick={handleClick}
                className={`relative ${CELL_SIZE} flex items-center justify-center bg-emerald-700 ${
                  clickable ? "cursor-pointer hover:bg-emerald-600" : "cursor-default"
                }`}
              >
                {isBest && (
                  <span className="absolute inset-0 border-2 border-yellow-400 rounded-sm pointer-events-none" />
                )}
                {isCandidate && (
                  <span className="absolute inset-0 border-2 border-yellow-200/50 rounded-sm pointer-events-none" />
                )}
                {isLegalMoveCell && (
                  <span className="w-3 h-3 rounded-full bg-emerald-300/80 pointer-events-none" />
                )}
                {cell !== EMPTY && (
                  <span
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full ${
                      cell === BLACK ? "bg-neutral-900" : "bg-white"
                    } shadow-inner`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
