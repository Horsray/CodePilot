#!/usr/bin/env bash
#
# CodePilot 桌面端构建脚本
# 标准流程见 .claude/skills/codepilot-electron-build（测试 → 清理 → 构建 → 打包）
#
# 用法:
#   ./build.sh                 # macOS arm64（默认，Apple Silicon）
#   ./build.sh --x64           # macOS x64（Intel）
#   ./build.sh --mac-both      # macOS arm64 + x64 都构建
#   ./build.sh --win           # Windows NSIS 安装包（建议在 Windows 上执行）
#   ./build.sh --linux         # Linux 安装包
#   ./build.sh --skip-test     # 跳过单元测试（不推荐，仅赶时间时用）
#   ./build.sh --skip-clean    # 跳过清理（保留 .next 缓存，构建更快；改了依赖/配置时别用）
#   ./build.sh --help
#
# 产物输出: release/ 目录（dmg / exe / AppImage 等）
# 完成后自动挂载最新 dmg 弹出安装窗口（非 macOS 目标则打开 release/ 目录）
#
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

# ── 参数解析 ──────────────────────────────────────────────
TARGET="mac-arm64"
SKIP_TEST=0
SKIP_CLEAN=0

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arm64)       TARGET="mac-arm64" ;;
    --x64)         TARGET="mac-x64" ;;
    --mac-both)    TARGET="mac-both" ;;
    --win)         TARGET="win" ;;
    --linux)       TARGET="linux" ;;
    --skip-test)   SKIP_TEST=1 ;;
    --skip-clean)  SKIP_CLEAN=1 ;;
    -h|--help)     usage ;;
    *) echo "未知参数: $1（用 --help 查看用法）" >&2; exit 1 ;;
  esac
  shift
done

# ── 输出辅助 ──────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
step_no=0
step()  { step_no=$((step_no + 1)); echo -e "\n${CYAN}[$step_no/4] $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}! $*${NC}"; }
fail()  { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

START_TS=$(date +%s)
elapsed() { local s=$(( $(date +%s) - START_TS )); printf '%dm%02ds' $((s/60)) $((s%60)); }

echo -e "${CYAN}CodePilot 构建 — 目标: ${TARGET}${NC}"
echo "项目目录: ${PROJECT_DIR}"

# ── 前置检查 ──────────────────────────────────────────────
[[ -f package.json ]] || fail "当前目录不是项目根目录（找不到 package.json）"
command -v node >/dev/null || fail "未找到 node，请先安装 Node.js"
command -v npm  >/dev/null || fail "未找到 npm"
[[ -d node_modules ]] || fail "node_modules 不存在，请先执行 npm install"

# ── 1. 测试 ───────────────────────────────────────────────
if [[ "$SKIP_TEST" == "1" ]]; then
  warn "已跳过测试（--skip-test）"
else
  step "运行测试（typecheck + 单元测试）"
  npm run test || fail "测试未通过，已中止构建。修完再构建，或用 --skip-test 强行跳过（不推荐）"
  ok "测试通过"
fi

# ── 2. 清理 ───────────────────────────────────────────────
if [[ "$SKIP_CLEAN" == "1" ]]; then
  warn "已跳过清理（--skip-clean）"
else
  step "清理旧产物（停掉 dev server，删除 .next / dist-electron）"
  # 停掉可能占用 .next 的 dev server（仅匹配 next 的 dev/server 进程，不影响其它程序）
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
  sleep 1
  rm -rf .next dist-electron
  ok "已清理"
fi

# ── 3. 构建（Next.js + Electron 主进程）───────────────────
step "构建应用（next build + Electron 主进程编译）"
npm run electron:build || fail "electron:build 失败"
ok "应用构建完成"

# ── 4. 打包（electron-builder）────────────────────────────
step "打包安装包（electron-builder）"
case "$TARGET" in
  mac-arm64)
    npx electron-builder --mac --arm64 --config electron-builder.yml
    ;;
  mac-x64)
    npx electron-builder --mac --x64 --config electron-builder.yml
    ;;
  mac-both)
    npx electron-builder --mac --arm64 --config electron-builder.yml
    npx electron-builder --mac --x64 --config electron-builder.yml
    ;;
  win)
    npx electron-builder --win --config electron-builder.yml
    ;;
  linux)
    npx electron-builder --linux --config electron-builder.yml
    ;;
esac
ok "打包完成"

# ── 结果 ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}构建完成，总耗时 $(elapsed)${NC}"
echo "产物目录: ${PROJECT_DIR}/release/"
find release -maxdepth 1 \( -name "*.dmg" -o -name "*.exe" -o -name "*.AppImage" -o -name "*.deb" -o -name "*.zip" \) -newermt "-2 hours" 2>/dev/null \
  | while read -r f; do echo "  - $(basename "$f")  ($(du -h "$f" | cut -f1))"; done

# ── 自动打开产物 ──────────────────────────────────────────
# macOS 目标：挂载最新产出的 dmg，直接弹出安装窗口；
# 其他平台目标（exe / AppImage 本机打不开）退化为打开 release 目录。
if [[ "$TARGET" == mac-* ]]; then
  # || true 兜底：无 dmg 时 ls 失败，避免 set -e 在半途退出
  DMG=$(ls -t release/*.dmg 2>/dev/null | head -1 || true)
  if [[ -n "$DMG" && -f "$DMG" ]]; then
    if open "$DMG"; then ok "已挂载 $(basename "$DMG")"; else warn "打开 dmg 失败，请手动到 release/ 查看"; fi
  else
    warn "未找到 dmg 产物，改为打开 release/ 目录"
    open release/ 2>/dev/null || true
  fi
else
  open release/ 2>/dev/null || true
fi

echo ""
echo -e "${YELLOW}提示：macOS 未签名包首次打开若被 Gatekeeper 拦截，请在「系统设置 > 隐私与安全性」中允许。${NC}"
