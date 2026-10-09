"use client";

/**
 * 统一的 Markdown 渲染配置。
 *
 * 背景：项目里有多处直接使用 `<Streamdown>`（助手正文、思维链面板、时间线中段文字）。
 * 之前只有 `message.tsx` 覆盖了 `pre`，其余调用点让代码围栏落到 Streamdown 内置代码块上，
 * 结果同一段 Markdown 在不同位置渲染出两套外观：字号 13px vs 14px、头部按钮不同、
 * 内边距/圆角/底色不同，宽表格还会因为 flex 子项缺少 min-w-0 而撑破消息列。
 *
 * 这里把所有覆盖集中成一份，所有调用点共用：
 * - `pre` → 项目自研 `CodeBlock`（行号、语言标签、复制、可折叠），字号固定 13px；
 * - 行内 `code` / 标题 / 表格单元格 → 用相对字号（em），跟随所在上下文，不再写死 text-sm；
 * - 表格其余外观由 Streamdown 自身的 wrapper + globals.css 统一。
 */

import type { ReactNode } from "react";
import { FileText } from "@phosphor-icons/react";
import type { Components } from "streamdown";
import { cn } from "@/lib/utils";
import { usePanelStore } from "@/store/usePanelStore";
import { CodeBlock } from "./code-block";

/** Markdown 容器的统一 prose 类，避免各调用点各写一份后漂移。 */
export const MARKDOWN_PROSE_CLASS =
  "prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/** 递归拍平 React 节点为纯文本，用于识别「整段就是一个路径 / URL」的节点。 */
export function extractNodeText(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (node && typeof node === "object" && "props" in (node as { props?: unknown })) {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props?.children != null) return extractNodeText(props.children);
  }
  return "";
}

/** 判断文本是否是「一个文件/目录路径」，而不是句子的一部分。 */
function isBarePath(text: string): boolean {
  return (text.startsWith("/") || /^[a-zA-Z]:\\/.test(text)) && !text.includes(" ") && text.length > 2;
}

function isUrl(text: string): boolean {
  return text.startsWith("http://") || text.startsWith("https://");
}

function openFileInApp(path: string) {
  window.dispatchEvent(new CustomEvent("open-file", { detail: { path } }));
}

function openUrlInApp(href: string) {
  usePanelStore.getState().openBrowserTab(href, "网页预览");
}

/** 文件路径胶囊（行内样式），list / p / a / code 四处共用同一外观。 */
function FilePathChip({
  path,
  className,
  onActivate,
}: {
  path: string;
  className?: string;
  onActivate?: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      className={cn(
        "group inline-flex max-w-full cursor-pointer items-start gap-2 rounded-[6px] border border-border/60 bg-muted/30 px-2.5 py-1.5 text-left text-[0.92em] align-middle transition-colors hover:bg-muted/60",
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        onActivate?.(e);
        openFileInApp(path);
      }}
    >
      <FileText size={14} className="mt-[2px] shrink-0 text-muted-foreground transition-colors group-hover:text-blue-500" />
      <span className="break-all pt-[1px] font-mono leading-[1.3] text-foreground/80">{path}</span>
    </span>
  );
}

/** 行内代码 / 链接 / 文件路径胶囊的公共外观，字号用 em 跟随上下文。 */
const inlineCodeClass =
  "rounded-md border border-border/30 bg-muted/40 px-1.5 py-0.5 font-mono text-[0.92em]";

/**
 * 所有 `<Streamdown>` 调用点共用的 components 映射。
 * 模块级常量：引用稳定，避免每次渲染重建导致 Streamdown 子树重渲。
 */
export const markdownComponents = {
  pre: ({ children, ...preProps }: any) => {
    const codeEl = Array.isArray(children) ? children[0] : children;
    if (codeEl && typeof codeEl === "object" && "props" in codeEl) {
      const className = codeEl.props.className || "";
      const match = /language-(\w+)/.exec(className);
      const language = match ? match[1] : "text";
      const codeString = extractNodeText(codeEl.props.children).replace(/\n$/, "");
      return <CodeBlock code={codeString} language={language} className="my-4" />;
    }
    return <pre {...preProps}>{children}</pre>;
  },

  code: ({ children, className, ...codeProps }: any) => {
    // 带 language- 前缀说明它属于某个 <pre>，交给上面的 pre 覆盖统一处理
    if (className && (className.includes("language-") || className.includes("!bg-["))) {
      return <code className={className} {...codeProps}>{children}</code>;
    }

    const text = extractNodeText(children).trim();

    if (isBarePath(text)) {
      return <FilePathChip path={text} className="mx-1" />;
    }

    if (isUrl(text)) {
      return (
        <span
          className={cn(inlineCodeClass, "break-all cursor-pointer text-blue-500 underline hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300", className)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openUrlInApp(text);
          }}
        >
          {text}
        </span>
      );
    }

    return (
      <code className={cn(inlineCodeClass, "text-foreground/90", className)} {...codeProps}>
        {children}
      </code>
    );
  },

  a: ({ node: _node, href, children, onClick, ...aProps }: any) => {
    const text = extractNodeText(children).trim();
    if (isBarePath(text)) {
      return <FilePathChip path={text} className="mx-1 my-1" />;
    }
    return (
      <a
        href={href}
        {...aProps}
        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
          if (href && isUrl(href)) {
            e.preventDefault();
            openUrlInApp(href);
          } else if (onClick) {
            onClick(e);
          }
        }}
      >
        {children}
      </a>
    );
  },

  p: ({ children, ...pProps }: any) => {
    const text = extractNodeText(children).trim();
    if (isBarePath(text)) {
      return <FilePathChip path={text} className="my-2" />;
    }
    return <p {...pProps}>{children}</p>;
  },

  li: ({ children, ...liProps }: any) => {
    const text = extractNodeText(children).trim();
    if (isBarePath(text)) {
      return (
        <li className="relative my-2 flex list-none items-start" {...liProps}>
          <FilePathChip path={text} />
        </li>
      );
    }
    return <li {...liProps}>{children}</li>;
  },

  // 标题：与 globals.css 里 `.prose h1~h6` 的压平策略保持一致。
  // 紧凑面板（思维链等）没有 `prose` 类，若不显式覆盖，h1 会按浏览器默认 2em 渲染，
  // 在 12px 的盒子里会显得极其突兀。
  h1: ({ children, className, ...props }: any) => (
    <h1 className={cn("mt-4 mb-2 border-b border-border pb-1 text-[1.125em] font-bold leading-snug", className)} {...props}>{children}</h1>
  ),
  h2: ({ children, className, ...props }: any) => (
    <h2 className={cn("mt-3 mb-1.5 text-[1em] font-semibold leading-snug", className)} {...props}>{children}</h2>
  ),
  h3: ({ children, className, ...props }: any) => (
    <h3 className={cn("mt-3 mb-1.5 text-[1em] font-semibold leading-snug text-muted-foreground", className)} {...props}>{children}</h3>
  ),
  h4: ({ children, className, ...props }: any) => (
    <h4 className={cn("mt-2 mb-1 text-[1em] font-semibold leading-snug text-muted-foreground", className)} {...props}>{children}</h4>
  ),
  h5: ({ children, className, ...props }: any) => (
    <h5 className={cn("mt-2 mb-1 text-[1em] font-semibold leading-snug text-muted-foreground", className)} {...props}>{children}</h5>
  ),
  h6: ({ children, className, ...props }: any) => (
    <h6 className={cn("mt-2 mb-1 text-[1em] font-semibold leading-snug text-muted-foreground", className)} {...props}>{children}</h6>
  ),

  // 表格：字号改为跟随上下文 —— Streamdown 默认写死 text-sm(14px)，
  // 在 12px 的紧凑面板里会显得特别大，正是「有的表格字体特别大」的来源。
  thead: ({ children, className, ...props }: any) => (
    <thead className={cn("bg-muted/60", className)} {...props}>{children}</thead>
  ),
  th: ({ children, className, ...props }: any) => (
    <th className={cn("whitespace-nowrap px-3 py-1.5 text-left align-top text-[1em] font-semibold", className)} {...props}>
      {children}
    </th>
  ),
  td: ({ children, className, ...props }: any) => (
    <td className={cn("break-words px-3 py-1.5 align-top text-[1em]", className)} {...props}>
      {children}
    </td>
  ),
} as Components;
