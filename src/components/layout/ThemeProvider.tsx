"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// 中文注释：移植 cc-haha 后主题切换改用 data-theme 属性（与 [data-theme="dark"] 选择器、dark: 变体保持一致），
// 不再使用 .dark class。
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
