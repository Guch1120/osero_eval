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
    <div className="inline-grid grid-cols-8 gap-[2px] bg-emerald-950 p-[2px] rounded-md select-none">
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
            className={`relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-emerald-700 ${
              clickable ? "cursor-pointer hover:bg-emerald-600" : "cursor-default"
            }`}
          >
            {isBest && (
              <span className="absolute inset-0 border-2 border-yellow-400 rounded-sm pointer-events-none" />
            )}
            {isCandidate && (
              <span className="absolute inset-0 border-2 border-yellow-200/50 rounded-sm pointer-events-none" />
            )}
            {isLegalMoveCell && <span className="w-3 h-3 rounded-full bg-emerald-300/80 pointer-events-none" />}
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
  );
}
