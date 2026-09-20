"use client";

import { BLACK, EMPTY, WHITE, type Board } from "@/lib/othello";

interface Props {
  board: Board;
  editable?: boolean;
  onCellClick?: (index: number) => void;
  bestMove?: number | null;
  candidateMoves?: number[];
}

export default function BoardGrid({ board, editable, onCellClick, bestMove, candidateMoves }: Props) {
  return (
    <div className="inline-grid grid-cols-8 gap-[2px] bg-emerald-950 p-[2px] rounded-md select-none">
      {board.map((cell, i) => {
        const isBest = bestMove === i;
        const isCandidate = !isBest && candidateMoves?.includes(i);
        return (
          <button
            key={i}
            type="button"
            disabled={!editable}
            onClick={() => onCellClick?.(i)}
            className={`relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-emerald-700 ${
              editable ? "cursor-pointer hover:bg-emerald-600" : "cursor-default"
            }`}
          >
            {isBest && (
              <span className="absolute inset-0 border-2 border-yellow-400 rounded-sm pointer-events-none" />
            )}
            {isCandidate && (
              <span className="absolute inset-0 border-2 border-yellow-200/50 rounded-sm pointer-events-none" />
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
  );
}
