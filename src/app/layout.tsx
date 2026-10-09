import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { AppShell } from "@/components/layout/AppShell";
import { getSetting } from "@/lib/db";

export const metadata: Metadata = {
  title: "HueyingAgent",
  description: "A multi-model AI agent desktop client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read theme preferences from DB (persisted across sessions).
  // Wrapped in try-catch because during `next build`, multiple worker processes
  // prerender pages concurrently through this layout, all hitting getDb().
  // SQLite cannot handle parallel writes from separate processes ("database is locked").
  let dbThemeMode: string | undefined;
  try {
    dbThemeMode = getSetting('theme_mode') || undefined;
  } catch {
    // Build-time or DB unavailable — fall back to localStorage-only theme
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* 中文注释：把一个库同步的亮暗模式写进 next-themes 的 localStorage，避免首帧闪烁。
            多主题家族系统已随 cc-haha 视觉移植一并移除。 */}
        {dbThemeMode && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(!localStorage.getItem('theme')){localStorage.setItem('theme',${JSON.stringify(dbThemeMode)})}}catch(e){}})();` }} suppressHydrationWarning />
        )}
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <I18nProvider>
            <AppShell>{children}</AppShell>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
