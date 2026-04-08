"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowSquareOut,
  CheckCircle,
  Code,
  DownloadSimple,
  Info,
  Sparkle,
} from "@/components/ui/icon";

const OFFICIAL_DOCS_URL = "https://developers.openai.com/codex/ide";
const MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=openai.chatgpt";
const INSTALL_COMMAND = "code --install-extension openai.chatgpt";

const supportedEditors = ["VS Code", "Cursor", "Windsurf", "其他兼容 VS Code Marketplace 的编辑器"];

const highlights = [
  "这是 OpenAI 官方的 Codex IDE 扩展，不是独立的扩展商店。",
  "直接面向代码编辑场景，定位和 Trae / VS Code 里的 AI 编码扩展一致。",
  "安装来源收敛到官方文档和官方 Marketplace，避免再出现一堆无关扩展。",
];

const quickSteps = [
  "在 VS Code 或兼容编辑器里打开 Extensions。",
  "搜索并安装 OpenAI 发布的 Codex 扩展，或直接打开官方 Marketplace。",
  "安装后用你的 OpenAI 账号登录，即可在编辑器里直接使用 Codex。",
];

export function CodexPanel() {
  const [copied, setCopied] = useState(false);

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_30%)] px-6 py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Sparkle size={12} />
                  Official Extension
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">GPT Codex IDE 扩展</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  这里展示的是 OpenAI 官方的 Codex IDE 扩展入口。它对应的是你在 Trae、VS Code
                  这类编辑器里直接安装和使用的那种扩展，不再展示无关的 marketplace、skills
                  或 mock 列表。
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild>
                  <a href={MARKETPLACE_URL} target="_blank" rel="noreferrer">
                    <DownloadSimple size={16} />
                    打开 Marketplace
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={OFFICIAL_DOCS_URL} target="_blank" rel="noreferrer">
                    <ArrowSquareOut size={16} />
                    查看官方文档
                  </a>
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 px-6 py-5 md:grid-cols-3">
            {highlights.map((item) => (
              <div key={item} className="rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle size={16} className="text-primary" />
                  方向已修正
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="gap-4">
            <CardHeader className="gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Code size={18} />
                直接安装
              </div>
              <CardTitle>官方安装入口</CardTitle>
              <CardDescription>
                优先使用 OpenAI 官方文档和官方 VS Code Marketplace 条目，不再走应用内自造扩展列表。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  CLI 安装命令
                </div>
                <code className="block overflow-x-auto rounded-lg bg-background px-3 py-3 font-mono text-sm text-foreground">
                  {INSTALL_COMMAND}
                </code>
              </div>

              <div className="space-y-3">
                {quickSteps.map((step, index) => (
                  <div key={step} className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                      {index + 1}
                    </div>
                    <p className="pt-0.5 text-sm leading-6 text-muted-foreground">{step}</p>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2 border-t border-border">
              <Button variant="outline" onClick={handleCopyCommand}>
                {copied ? "已复制命令" : "复制安装命令"}
              </Button>
              <Button asChild variant="ghost">
                <a href={MARKETPLACE_URL} target="_blank" rel="noreferrer">
                  <ArrowSquareOut size={16} />
                  在浏览器中打开
                </a>
              </Button>
            </CardFooter>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="gap-4">
              <CardHeader className="gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Info size={18} />
                  兼容编辑器
                </div>
                <CardTitle>类似 Trae / VS Code 的使用方式</CardTitle>
                <CardDescription>
                  OpenAI 官方文档当前明确覆盖 VS Code，以及 Cursor、Windsurf 这类兼容环境。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {supportedEditors.map((editor) => (
                  <div
                    key={editor}
                    className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
                  >
                    <span className="text-foreground">{editor}</span>
                    <CheckCircle size={16} className="text-primary" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="gap-4">
              <CardHeader className="gap-3">
                <CardTitle>面板语义</CardTitle>
                <CardDescription>
                  这个入口现在只代表 GPT Codex 扩展本身，不再代表一个泛化的“扩展中心”。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  如果后续要做更深的集成，方向应该是围绕官方 Codex 扩展的登录、状态、跳转和使用入口展开，
                  而不是继续堆 unrelated extensions / skills 列表。
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
