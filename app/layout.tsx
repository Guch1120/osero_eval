import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "オセロ評価AI",
  description: "写真を撮るだけでオセロの盤面を評価する将棋AI風の勝率解説アプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen text-neutral-900">{children}</body>
    </html>
  );
}
