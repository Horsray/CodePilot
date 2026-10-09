import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { AppShell } from "@/components/layout/AppShell";
import { getSetting } from "@/lib/db";
import type { Locale } from "@/i18n";

export const metadata: Metadata = {
  title: "HueyingAgent",
  description: "A multi-model AI agent desktop client",
};

// 中文注释：根布局必须按请求动态渲染 —— 语言/主题需要在运行时从 DB 读取。
// 静态预渲染会把「英文 + 构建机主题」固化进打包产物，用户每次冷启动都会先
// 闪一帧英文界面，等客户端拉到设置后才切回中文。
export const dynamic = "force-dynamic";

/** First-run fallback (no persisted locale yet): infer the UI language from Accept-Language. */
function detectLocaleFromAcceptLanguage(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return "en";
  return acceptLanguage.toLowerCase().includes("zh") ? "zh" : "en";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 中文注释：await headers() 让本布局成为动态依赖，与上方 force-dynamic 声明一致。
  const requestHeaders = await headers();

  // Read locale + theme preferences from DB (persisted across sessions).
  // Wrapped in try-catch because the DB may be unavailable during `next build`.
  let dbThemeMode: string | undefined;
  let locale: Locale = detectLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  try {
    dbThemeMode = getSetting('theme_mode') || undefined;
    const savedLocale = getSetting('locale');
    if (savedLocale === 'en' || savedLocale === 'zh') {
      locale = savedLocale;
    }
  } catch {
    // Build-time or DB unavailable — fall back to Accept-Language + localStorage-only theme
  }

  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} suppressHydrationWarning>
      <head>
        {/* 中文注释：把一个库同步的亮暗模式写进 next-themes 的 localStorage，避免首帧闪烁。
            多主题家族系统已随 cc-haha 视觉移植一并移除。 */}
        {dbThemeMode && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(!localStorage.getItem('theme')){localStorage.setItem('theme',${JSON.stringify(dbThemeMode)})}}catch(e){}})();` }} suppressHydrationWarning />
        )}
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <I18nProvider initialLocale={locale}>
            <AppShell>{children}</AppShell>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
