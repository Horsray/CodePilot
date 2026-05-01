"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useWebTerminal } from "@/hooks/useWebTerminal";
import { usePanel } from "@/hooks/usePanel";
import { XtermTerminal } from "@/components/terminal/XtermTerminal";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import {
  SpinnerGap,
  Plus,
  Wrench,
  X,
  Trash,
  Play,
  TerminalWindow,
  PencilSimple,
} from "@/components/ui/icon";
import type { Terminal } from "@xterm/xterm";

// ─── 待执行命令缓存 ──────────────────────────────────────────
let pendingExecuteCommand: string | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("terminal:execute-command", (e: Event) => {
    const detail = (e as CustomEvent).detail as { command: string } | undefined;
    if (detail) pendingExecuteCommand = detail.command;
  });
}

// ─── 类型定义 ─────────────────────────────────────────────────
interface QuickCommand {
  id: string;
  label: string;
  command: string;
  isPreset?: boolean;
}

interface TerminalSession {
  id: string;
  name: string;
}

// ─── 预设命令 ─────────────────────────────────────────────────
const DEFAULT_PRESETS: QuickCommand[] = [
  { id: "preset-1", label: "Dev Server", command: "npm run dev", isPreset: true },
  { id: "preset-2", label: "Build", command: "npm run build:single", isPreset: true },
  { id: "preset-3", label: "Test", command: "npm run test", isPreset: true },
  {
    id: "preset-4",
    label: "Build Electron (arm64)",
    command: "rm -rf dist-electron && npm run electron:build && npm run electron:pack:mac -- --arm64",
    isPreset: true,
  },
  {
    id: "preset-5",
    label: "Clean & Restart",
    command: `pkill -f "next" 2>/dev/null; sleep 1; rm -rf /Users/horsray/Documents/codepilot/CodePilot/.next /Users/horsray/Documents/codepilot/CodePilot/dist-electron 2>/dev/null; echo "cleaned"`,
    isPreset: true,
  },
];

// ─── localStorage helpers ─────────────────────────────────────
const CMD_STORAGE_KEY = "codepilot-terminal-quick-commands";

function loadCommands(): QuickCommand[] {
  if (typeof window === "undefined") return [...DEFAULT_PRESETS];
  try {
    const raw = localStorage.getItem(CMD_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PRESETS];
    const parsed = JSON.parse(raw) as QuickCommand[];
    // 确保预设命令不丢失
    const presetIds = new Set(DEFAULT_PRESETS.map((p) => p.id));
    const hasPresets = parsed.some((p) => presetIds.has(p.id));
    if (!hasPresets) {
      return [...DEFAULT_PRESETS, ...parsed];
    }
    return parsed;
  } catch {
    return [...DEFAULT_PRESETS];
  }
}

function saveCommands(cmds: QuickCommand[]) {
  try {
    localStorage.setItem(CMD_STORAGE_KEY, JSON.stringify(cmds));
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
// WebTerminalPanel — 主入口
// ═══════════════════════════════════════════════════════════════
export function WebTerminalPanel({ terminalId }: { terminalId?: string }) {
  const { workingDirectory, sessionId } = usePanel();
  const identity = terminalId || `${sessionId || "default"}:${workingDirectory || "workspace-default"}`;

  // 多终端会话状态
  const [sessions, setSessions] = useState<TerminalSession[]>([
    { id: "default", name: "终端 1" },
  ]);
  const [activeSessionId, setActiveSessionId] = useState("default");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 面板状态
  const [showQuickCmds, setShowQuickCmds] = useState(false);
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCmd, setEditCmd] = useState("");

  // 加载命令
  useEffect(() => {
    setCommands(loadCommands());
  }, []);

  // 监听来自 BottomPanelContainer 的自定义事件
  useEffect(() => {
    const handleNewSession = () => {
      const num = sessions.length + 1;
      const id = `session-${Date.now()}`;
      setSessions((prev) => [...prev, { id, name: `终端 ${num}` }]);
      setActiveSessionId(id);
      setSidebarOpen(true);
    };
    const handleToggleCmds = () => {
      setShowQuickCmds((v) => !v);
    };
    window.addEventListener("terminal:new-session", handleNewSession);
    window.addEventListener("terminal:toggle-quick-cmds", handleToggleCmds);
    return () => {
      window.removeEventListener("terminal:new-session", handleNewSession);
      window.removeEventListener("terminal:toggle-quick-cmds", handleToggleCmds);
    };
  }, [sessions.length]);

  // 点击外部关闭命令面板
  useEffect(() => {
    if (!showQuickCmds) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-cmd-panel]")) return;
      setShowQuickCmds(false);
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [showQuickCmds]);

  // 命令操作
  const executeCommand = useCallback((cmd: string) => {
    window.dispatchEvent(new CustomEvent("terminal:execute-command", { detail: { command: cmd } }));
    setShowQuickCmds(false);
  }, []);

  const addCommand = useCallback(() => {
    if (!newLabel.trim() || !newCmd.trim()) return;
    const updated = [...commands, { id: `user-${Date.now()}`, label: newLabel.trim(), command: newCmd.trim() }];
    setCommands(updated);
    saveCommands(updated);
    setNewLabel("");
    setNewCmd("");
    setShowAddForm(false);
  }, [newLabel, newCmd, commands]);

  const deleteCommand = useCallback(
    (id: string) => {
      const updated = commands.filter((c) => c.id !== id);
      setCommands(updated);
      saveCommands(updated);
    },
    [commands]
  );

  const startEdit = useCallback((cmd: QuickCommand) => {
    setEditingId(cmd.id);
    setEditLabel(cmd.label);
    setEditCmd(cmd.command);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId || !editLabel.trim() || !editCmd.trim()) return;
    const updated = commands.map((c) =>
      c.id === editingId ? { ...c, label: editLabel.trim(), command: editCmd.trim() } : c
    );
    setCommands(updated);
    saveCommands(updated);
    setEditingId(null);
  }, [editingId, editLabel, editCmd, commands]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  // 会话操作
  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      if (sessions.length <= 1) return;
      const filtered = sessions.filter((s) => s.id !== id);
      setSessions(filtered);
      if (activeSessionId === id) {
        setActiveSessionId(filtered[filtered.length - 1].id);
      }
      if (filtered.length < 2) setSidebarOpen(false);
    },
    [sessions, activeSessionId]
  );

  const showSidebar = sidebarOpen && sessions.length >= 2;

  return (
    <div className="h-full w-full flex relative">
      {/* 会话侧边栏 */}
      {showSidebar && (
        <div className="w-40 shrink-0 border-r border-border/40 bg-muted/20 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/30">
            <span className="text-[10px] text-muted-foreground font-medium">会话</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="h-4 w-4 text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={10} />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto py-0.5">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs transition-colors ${
                  activeSessionId === s.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
                onClick={() => switchSession(s.id)}
              >
                <TerminalWindow size={11} className="shrink-0 opacity-60" />
                <span className="flex-1 truncate">{s.name}</span>
                {sessions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                  >
                    <X size={9} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 终端主体 */}
      <div className="flex-1 min-w-0 relative">
        {/* 多会话：隐藏非活跃会话，保持 PTY 存活 */}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={activeSessionId === s.id ? "h-full w-full" : "hidden"}
          >
            <SingleTerminalSession
              sessionKey={`${identity}:${s.id}`}
              terminalId={s.id}
              isActive={activeSessionId === s.id}
            />
          </div>
        ))}

        {/* 快捷命令面板 — 渲染在终端区域内 */}
        {showQuickCmds && (
          <div
            data-cmd-panel
            className="absolute top-0 right-0 bottom-0 z-40 w-80 bg-background border-l border-border/60 shadow-xl flex flex-col"
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 shrink-0">
              <span className="text-xs font-medium text-foreground">快捷命令</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  title="新增命令"
                  onClick={() => setShowAddForm((v) => !v)}
                >
                  <Plus size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowQuickCmds(false)}
                >
                  <X size={12} />
                </Button>
              </div>
            </div>

            {/* 新增命令表单 */}
            {showAddForm && (
              <div className="px-3 py-2 border-b border-border/40 bg-muted/20 space-y-1.5">
                <input
                  className="w-full h-7 px-2 text-xs rounded-md border border-border/60 bg-background outline-none focus:ring-1 focus:ring-primary/40"
                  placeholder="名称"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  autoFocus
                />
                <input
                  className="w-full h-7 px-2 text-xs rounded-md border border-border/60 bg-background outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                  placeholder="命令"
                  value={newCmd}
                  onChange={(e) => setNewCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCommand();
                  }}
                />
                <div className="flex justify-end">
                  <Button
                    variant="default"
                    size="xs"
                    className="h-6 text-xs"
                    onClick={addCommand}
                    disabled={!newLabel.trim() || !newCmd.trim()}
                  >
                    添加
                  </Button>
                </div>
              </div>
            )}

            {/* 命令列表 — 可滚动，填满剩余空间 */}
            <div className="flex-1 overflow-y-auto py-1">
              {commands.map((cmd) => (
                <div key={cmd.id} className="group">
                  {editingId === cmd.id ? (
                    /* 编辑模式 */
                    <div className="px-3 py-1.5 space-y-1 bg-muted/30 border-b border-border/20">
                      <input
                        className="w-full h-6 px-1.5 text-xs rounded border border-border/60 bg-background outline-none focus:ring-1 focus:ring-primary/40"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        autoFocus
                      />
                      <input
                        className="w-full h-6 px-1.5 text-xs rounded border border-border/60 bg-background outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                        value={editCmd}
                        onChange={(e) => setEditCmd(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="xs" className="h-5 text-[10px] px-1.5" onClick={cancelEdit}>
                          取消
                        </Button>
                        <Button variant="default" size="xs" className="h-5 text-[10px] px-1.5" onClick={saveEdit}>
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 显示模式 */
                    <div
                      className="flex items-start gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer transition-colors border-b border-border/10"
                      onClick={() => executeCommand(cmd.command)}
                    >
                      <Play size={11} className="text-green-500 shrink-0 mt-0.5 opacity-60 group-hover:opacity-100" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{cmd.label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">{cmd.command}</div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          title="编辑"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(cmd);
                          }}
                        >
                          <PencilSimple size={10} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-5 w-5 text-muted-foreground hover:text-destructive"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCommand(cmd.id);
                          }}
                        >
                          <Trash size={10} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {commands.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">暂无命令</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SingleTerminalSession — 单个终端会话
// ═══════════════════════════════════════════════════════════════
function SingleTerminalSession({
  sessionKey,
  terminalId,
  isActive,
}: {
  sessionKey: string;
  terminalId: string;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const terminal = useWebTerminal();
  const xtermRef = useRef<Terminal | null>(null);
  const [terminalKey, setTerminalKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionAttempted, setConnectionAttempted] = useState(false);

  const handleData = useCallback(
    (data: string) => {
      void terminal.write(data);
    },
    [terminal]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      void terminal.resize(cols, rows);
    },
    [terminal]
  );

  const handleReady = useCallback(
    async (term: Terminal) => {
      xtermRef.current = term;
      setReady(true);
      setConnectionAttempted(true);
      setError(null);

      terminal.setOnData((data: string) => {
        if (xtermRef.current) xtermRef.current.write(data);
      });

      terminal.setOnExit((code: number) => {
        if (xtermRef.current) xtermRef.current.write(`\r\n[Process exited with code ${code}]\r\n`);
      });

      try {
        await terminal.create(term.cols, term.rows, terminalId);
      } catch (err) {
        setError(t("terminal.terminalError", { error: err instanceof Error ? err.message : "Unknown error" }));
      }

      // 执行缓存的命令
      if (pendingExecuteCommand && xtermRef.current) {
        const cmd = pendingExecuteCommand;
        pendingExecuteCommand = null;
        terminal.write(cmd + "\r");
      }
    },
    [terminal, t, terminalId]
  );

  // 连接超时
  useEffect(() => {
    if (!connectionAttempted || terminal.connected || error || terminal.exited) return;
    const timer = setTimeout(() => setError(t("terminal.failedToConnect")), 8000);
    return () => clearTimeout(timer);
  }, [connectionAttempted, error, t, terminal.connected, terminal.exited]);

  useEffect(() => {
    if (terminal.connected) setError(null);
  }, [terminal.connected]);

  useEffect(() => {
    if (!terminal.isElectron && terminal.connected) {
      setTimeout(() => void terminal.write("\n"), 500);
    }
  }, [terminal.connected, terminal.isElectron]);

  // AI 镜像
  useEffect(() => {
    if (!ready || !xtermRef.current) return;
    const handleMirror = (e: Event) => {
      const { action, command, output, exitCode } = (e as CustomEvent).detail || {};
      const term = xtermRef.current;
      if (!term) return;
      if (action === "command") term.write(`\r\n\x1b[36m❯ AI: ${command}\x1b[0m\r\n`);
      if (action === "output" && output) term.write(output);
      if (action === "exit" && exitCode !== 0) term.write(`\x1b[31m[Exit code: ${exitCode}]\x1b[0m\r\n`);
    };
    window.addEventListener("terminal:mirror", handleMirror);
    return () => window.removeEventListener("terminal:mirror", handleMirror);
  }, [ready]);

  // 执行命令事件
  useEffect(() => {
    if (!ready || !xtermRef.current) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { command: string } | undefined;
      if (!detail || !xtermRef.current) return;
      terminal.write(detail.command + "\r");
      pendingExecuteCommand = null;
    };
    window.addEventListener("terminal:execute-command", handler);
    return () => window.removeEventListener("terminal:execute-command", handler);
  }, [ready, terminal]);

  const handleRetry = useCallback(() => {
    setError(null);
    setConnectionAttempted(false);
    setReady(false);
    void terminal.kill();
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    setTerminalKey((k) => k + 1);
  }, [terminal]);

  return (
    <div className="h-full w-full relative" onClick={() => xtermRef.current?.focus()}>
      <XtermTerminal
        key={terminalKey}
        onData={handleData}
        onResize={handleResize}
        onReady={handleReady}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background p-4">
          <div className="text-red-400 mb-2">{t("terminal.terminalErrorTitle")}</div>
          <div className="text-sm text-gray-400 mb-4 text-center max-w-md">{error}</div>
          <div className="text-xs text-gray-500 mb-4">{t("terminal.terminalErrorHint")}</div>
          <Button onClick={handleRetry} className="px-4 py-2 text-sm">
            {t("terminal.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
