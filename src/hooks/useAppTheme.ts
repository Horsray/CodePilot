import { useTheme } from 'next-themes';

// 中文注释：多主题家族已移除，仅保留亮/暗/跟随系统三种模式。
export function useAppTheme() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return {
    mode: theme,
    setMode: setTheme,
    resolvedMode: resolvedTheme,
  };
}
