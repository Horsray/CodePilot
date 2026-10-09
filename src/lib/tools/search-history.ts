import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './index';
import { searchMessages } from '@/lib/db';

export function createSearchHistoryTool(_ctx: ToolContext) {
  return tool({
    description:
      'Search local chat history message contents across sessions. ' +
      'Returns matching sessions and snippets. Use when you need to recall prior discussion or implementation context.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Keyword or phrase to search in local chat history'),
      session_id: z.string().optional().describe('Optional session ID to restrict the search'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum number of matches to return'),
    }),
    execute: async ({ query, session_id, limit }) => {
      const results = searchMessages(query, {
        ...(session_id ? { sessionId: session_id } : {}),
        ...(limit ? { limit } : {}),
      });

      if (results.length === 0) {
        return `No local chat history matched "${query}".`;
      }

      return results.map((item, index) => {
        const title = item.sessionTitle || item.sessionId;
        return [
          `${index + 1}. ${title}`,
          `   session_id: ${item.sessionId}`,
          `   role: ${item.role}`,
          `   created_at: ${item.createdAt}`,
          `   snippet: ${item.snippet.replace(/\s+/g, ' ').trim()}`,
        ].join('\n');
      }).join('\n\n');
    },
  });
}

