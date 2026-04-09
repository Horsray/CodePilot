import { tool } from "ai";
import { z } from "zod";
import { getBrowserSessionContext } from "@/lib/browser-context-store";
import type { ToolContext } from "./index";

export function createBrowserContextTool(ctx: ToolContext) {
  return tool({
    description:
      "Read the latest built-in browser context for the current chat session, including the active URL, page title, " +
      "and recent console entries from the embedded browser. Use this when debugging web apps, checking browser-side " +
      "errors, or understanding what happened after opening a preview page.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).optional().describe("How many recent console entries to include"),
      levels: z.array(z.enum(["log", "info", "warn", "error", "debug"])).optional()
        .describe("Optional log levels to include"),
    }),
    execute: async ({ limit, levels }) => {
      if (!ctx.sessionId) {
        return "No active session is available for browser context.";
      }

      const context = getBrowserSessionContext(ctx.sessionId);
      if (!context) {
        return "No browser context has been captured for this session yet.";
      }

      const filteredLogs = context.logs
        .filter((entry) => !levels || levels.includes(entry.level))
        .slice(-(limit || 20));

      return JSON.stringify({
        sessionId: context.sessionId,
        url: context.url || null,
        title: context.title || null,
        updatedAt: context.updatedAt,
        logs: filteredLogs,
      }, null, 2);
    },
  });
}
