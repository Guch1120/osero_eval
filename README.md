# オセロ評価AI

スマホのカメラでオセロ盤を撮影するだけで、将棋の指し手評価AIのように
「勝率(数値)」と「その理由の解説文」を表示するアプリです。

## アーキテクチャ / なぜこの構成か

将棋・囲碁・オセロのような完全情報ゲームでは、LLM単体に盤面の勝率を
計算させると根拠が曖昧で数値も安定しません。そこで本アプリでは役割を分けています。

| 役割 | 担当 | 理由 |
| --- | --- | --- |
| 写真 → 8×8盤面の読み取り | マルチモーダルLLM (Gemma 4 31B Instruct, Google AI Studio無料枠) | 画像からの構造化データ抽出はLLMの得意分野 |
| 勝率・最善手の計算 | 自作のαβ探索エンジン (`lib/othello.ts`) | オセロは読み切り可能な完全情報ゲーム。数値の正確さ・再現性が最重要なのでLLMに計算させない |
| 解説文の生成 | LLM (同じ無料枠モデル) | 探索エンジンが出した数値・特徴量を渡し、文章化のみを行わせる(数値の再計算は禁止するプロンプト) |

盤面が終盤(空きマス10以下、環境変数で調整可)になると、探索エンジンは
ゲーム終了まで完全読み切りを試みます。それより手前では位置評価(角・
着手可能数・確定石の少なさなど)を使ったヒューリスティック探索になります。

写真を使わず結果だけを確認したい場合や、Gemmaの読み取り精度が不十分な
場合のために、盤面を直接タップして入力・修正できるUIも用意しています
(LLMなしでも動作するフォールバック経路)。

## 使い方

1. 「初期配置から開始」を押す
2. 実際の盤に石を置いたら、「石を置いたら撮影」ボタンでその瞬間の盤面を撮影
   (将棋の対局時計のボタンのような感覚で、1手ごとに押す)
3. LLMが盤面を読み取るので、間違っていればタップして修正し、次の手番を確認
4. 「この盤面で評価する」を押すと、勝率バーと解説文が表示される
5. 次の一手が打たれたら 2〜4 を繰り返す

## セットアップ

```bash
npm install
cp .env.example .env.local
# .env.local に GOOGLE_API_KEY を設定 (https://aistudio.google.com/apikey で無料取得)
npm run dev
```

`GOOGLE_API_KEY` は Google AI Studio の無料APIキーです。1日あたりの
無料リクエスト枠があるモデル(Gemma 4 / Gemini Flash など)を利用する
前提で設計しています。読み取り精度が気になる場合は `.env.local` の
`GEMINI_VISION_MODEL` を `gemini-flash-latest` に変えるだけで切り替えられます
(コード変更不要)。Gemma 4ファミリーには `gemma-4-26b-a4b-it` のようなテキスト
専用モデルもありますが、画像入力を受け付けないため `GEMINI_VISION_MODEL`
には使えません(`gemma-4-31b-it` のようなマルチモーダル版を指定してください)。

APIキーを設定しなくても、「現在の盤面を手動入力」からタップ入力すれば
勝率計算(探索エンジン部分)だけは利用できます。ただしその場合、解説文は
簡易な自動生成テキストにフォールバックします。

Gemmaのような無料の新しいオープンモデルは、需要が集中すると一時的に
`503 UNAVAILABLE`(高負荷)を返すことがあります。しかもこの高負荷は
Gemmaと`gemini-flash-latest`の両方に同時に起きることもあるため、
各APIコールは2段階のフォールバックを試みます。

1. `GEMINI_VISION_FALLBACK_MODEL` / `GEMINI_TEXT_FALLBACK_MODEL`
   (デフォルト `gemini-flash-latest`)
2. `GEMINI_VISION_FALLBACK_MODEL_2` / `GEMINI_TEXT_FALLBACK_MODEL_2`
   (デフォルト `gemini-flash-lite-latest`。Flashとは別の容量枠を持つ
   軽量モデルなので、Flash系全体が混雑していても通ることがあります)

それでも全モデルが失敗する場合は、数秒待って全モデルをもう一度
一巡する、という処理を時間予算の範囲内で繰り返します(Googleの503
エラーメッセージ自体が「高負荷は通常一時的」としているため)。

**モデル名は固定の日付付き名称(`gemini-2.0-flash` など)ではなく
`gemini-flash-latest` を使っています。** Googleは2026年に入ってから
Flashモデルを`3.5`→`3.6`→`3.7`→`3.8`のように頻繁に更新しており、
`gemini-2.0-flash`は2026年6月に廃止されました。`gemini-flash-latest`は
Google自身が管理する「常に最新の推奨Flashモデルを指す」エイリアスなので、
今後モデルが更新されても自動的に追従し、同じ廃止トラブルが起きません
(破壊的変更がある場合はGoogleが2週間前に通知するとされています)。
一方、Gemmaにはこの種のエイリアスが無いため、`GEMINI_VISION_MODEL`に
指定した`gemma-4-31b-it`のようなバージョン名はいずれ廃止される可能性が
あります。その場合も本アプリは自動的に`gemini-flash-latest`側にフォール
バックするので動作は止まりませんが、Gemma優先で使い続けたい場合は
[Google AI Studio](https://aistudio.google.com/)のモデル一覧で新しい
Gemmaバージョンが出ていないか時々確認し、`GEMINI_VISION_MODEL` /
`GEMINI_TEXT_MODEL` を更新してください。

## Vercelへのデプロイ

1. このリポジトリをGitHubに接続してVercelでインポート
2. Vercelのプロジェクト設定 → Environment Variables に `GOOGLE_API_KEY`
   (必要なら `GEMINI_VISION_MODEL` / `GEMINI_TEXT_MODEL`) を設定
3. Deploy

API routeには `maxDuration = 60` を設定済みです(Vercel Hobbyプランでも
設定可能な上限)。内部のGemini API呼び出しはこれより十分短い時間予算
(モデルごとに最大24秒など)で打ち切るようにしているので、プラットフォーム
側の強制終了(素の504)ではなく、常にわかりやすいJSONエラーを返します。

## 開発メモ

- `lib/othello.ts`: ルール実装・αβ探索・勝率変換。LLMに依存しない純粋関数群
  なので `npm run test:engine` で簡単な動作確認ができます。
- `lib/gemini.ts`: Google Generative Language API (Gemini/Gemma共通の
  REST エンドポイント) を呼び出す薄いクライアント。
- 評価値→勝率の変換式やヒューリスティックの重みは簡易的なチューニングです。
  実戦で精度が気になる場合は `lib/othello.ts` の `evaluateHeuristic` や
  探索深さ (`pickHeuristicDepth`) を調整してください。
