// Thin client for Google's Generative Language API (Google AI Studio),
// used for two things ONLY:
//   1. Reading an 8x8 Othello board off a photo (vision -> structured JSON).
//   2. Turning already-computed engine numbers into Japanese commentary.
// It is never used to compute the win probability itself — see lib/othello.ts.
//
// Works with both Gemini models (e.g. "gemini-2.0-flash") and Gemma models
// (e.g. "gemma-3-27b-it"), which are both free-tier and share this same
// REST endpoint. Switch models purely via env vars, no code changes needed.

import { BLACK, EMPTY, WHITE, type Board } from "./othello";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemma-3-27b-it";
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || VISION_MODEL;

function apiKey(): string {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_API_KEY (or GEMINI_API_KEY) is not set. Get a free key at https://aistudio.google.com/apikey and set it in your environment."
    );
  }
  return key;
}

interface GeneratePart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

async function generateContent(
  model: string,
  parts: GeneratePart[],
  opts: { systemInstruction?: string; jsonMode?: boolean; temperature?: number } = {}
): Promise<string> {
  const key = apiKey();
  const isGemma = model.startsWith("gemma");

  // Gemma's REST serving is less consistent about the systemInstruction
  // field than Gemini's, so fold it into the first text part instead.
  let finalParts = parts;
  if (opts.systemInstruction && isGemma) {
    finalParts = [{ text: opts.systemInstruction }, ...parts];
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: finalParts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      ...(opts.jsonMode && !isGemma ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.systemInstruction && !isGemma) {
    body.systemInstruction = { role: "system", parts: [{ text: opts.systemInstruction }] };
  }

  const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}) for model ${model}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: GeneratePart) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new Error(`Gemini API returned no text for model ${model}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

// ---------------------------------------------------------------------
// 1. Board digitization from a photo
// ---------------------------------------------------------------------

export interface DigitizeResult {
  board: Board;
  confidence: number;
  notes: string;
  raw: string;
}

const DIGITIZE_SYSTEM = `あなたはオセロ(リバーシ)の盤面を写真から読み取るアシスタントです。
写真に写った8x8の盤面を読み取り、必ず次のJSON形式のみを出力してください。説明文やコードフェンスは不要です。

{"rows": ["........", "........", "........", "........", "........", "........", "........", "........"], "confidence": 0.0, "notes": ""}

ルール:
- rows は必ず8要素、各要素は必ず8文字の文字列。
- 'B' = 黒石, 'W' = 白石, '.' = 空きマス。
- rows[0] が写真内で一番上の行、各行は左から右の順。
- confidence は読み取りの自信度(0〜1)。
- notes には読み取りにくかった箇所などがあれば短く記載(日本語)。無ければ空文字。
- 石の数の合計がずれていても構わないので、見たままを正直に出力してください。`;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function charToCell(ch: string): number {
  const c = ch.toUpperCase();
  if (c === "B") return BLACK;
  if (c === "W") return WHITE;
  return EMPTY;
}

export function parseDigitizeText(raw: string): DigitizeResult {
  const jsonText = stripCodeFence(raw);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`盤面認識の応答がJSONとして解析できませんでした: ${jsonText.slice(0, 300)}`);
  }
  const rows: unknown = parsed?.rows;
  if (!Array.isArray(rows) || rows.length !== 8 || rows.some((r) => typeof r !== "string" || r.length !== 8)) {
    throw new Error(`盤面認識の応答が想定形式(8x8)ではありません: ${jsonText.slice(0, 300)}`);
  }
  const board: Board = new Array(64).fill(EMPTY) as Board;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      board[r * 8 + c] = charToCell((rows[r] as string)[c]) as Board[number];
    }
  }
  return {
    board,
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0.5,
    notes: typeof parsed?.notes === "string" ? parsed.notes : "",
    raw: jsonText,
  };
}

export async function digitizeBoardFromPhoto(imageBase64: string, mimeType: string): Promise<DigitizeResult> {
  const text = await generateContent(
    VISION_MODEL,
    [
      { text: "この写真のオセロ盤面を読み取ってJSONで出力してください。" },
      { inlineData: { mimeType, data: imageBase64 } },
    ],
    { systemInstruction: DIGITIZE_SYSTEM, jsonMode: true, temperature: 0.1 }
  );
  return parseDigitizeText(text);
}

// ---------------------------------------------------------------------
// 2. Natural-language commentary generation
// ---------------------------------------------------------------------

const EXPLAIN_SYSTEM = `あなたはオセロの解説者です。与えられたデータは、探索エンジンが既に計算した確定値です。
あなたの役割は、その数値を基に日本語で簡潔に解説することだけです。
勝率や評価値を自分で計算し直したり、与えられた数値と矛盾する数値を書いたりしないでください。
出力は3〜5文程度の自然な日本語の文章のみとし、見出しや箇条書き、マークダウンは使わないでください。`;

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

export async function explainPosition(input: ExplainInput): Promise<string> {
  const payload = JSON.stringify(input, null, 2);
  const userText = `以下は${input.moverLabel}の手番の局面についての探索エンジンの計算結果です。この内容だけを根拠に解説してください。

${payload}

補足: mode が "exact" の場合、この先両者が最善を尽くした場合の確定的な結果(終盤までの読み切り)です。"heuristic" の場合は簡易評価関数による概算です。features の各値は「手番側にとって良いほどプラス」になるよう正規化されています(mobilityDiff=着手可能数の差, frontierDiff=相手に取られにくい石の割合の差, discDiff=石数の差, cornerDiff=角の獲得数の差)。`;

  return generateContent(TEXT_MODEL, [{ text: userText }], {
    systemInstruction: EXPLAIN_SYSTEM,
    temperature: 0.4,
  });
}
