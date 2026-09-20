"use client";

interface Props {
  blackPct: number; // 0-100
  whitePct: number; // 0-100
}

export default function EvalBar({ blackPct, whitePct }: Props) {
  return (
    <div className="w-full">
      <div className="flex justify-between text-sm mb-1">
        <span className="font-semibold">黒 {blackPct.toFixed(1)}%</span>
        <span className="font-semibold">白 {whitePct.toFixed(1)}%</span>
      </div>
      <div className="w-full h-6 rounded overflow-hidden flex border border-neutral-400">
        <div className="bg-neutral-900" style={{ width: `${blackPct}%` }} />
        <div className="bg-white" style={{ width: `${whitePct}%` }} />
      </div>
    </div>
  );
}
