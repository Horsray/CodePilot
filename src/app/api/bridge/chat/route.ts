/**
 * Bridge Chat API — receives messages from external bots (e.g. Feishu lark-cli)
 * and returns AI-generated responses via the CodePilot conversation engine.
 *
 * POST /api/bridge/chat
 * Body: { chat_id: string, text: string, session_id?: string, working_directory?: string }
 * Returns: { response: string, session_id: string, error?: string }
 */

import { NextRequest } from 'next/server';
import { processMessage } from '@/lib/bridge/conversation-engine';
import { resolve, createBinding } from '@/lib/bridge/channel-router';
import type { ChannelAddress } from '@/lib/bridge/types';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chat_id, text, session_id, working_directory } = body as {
      chat_id?: string;
      text?: string;
      session_id?: string;
      working_directory?: string;
    };

    if (!chat_id || !text) {
      return Response.json(
        { error: 'chat_id and text are required' },
        { status: 400 },
      );
    }

    // Resolve channel address for Feishu
    const address: ChannelAddress = {
      channelType: 'feishu',
      chatId: chat_id,
      displayName: `Feishu:${chat_id.slice(0, 8)}`,
    };

    // Resolve or create binding
    let binding;
    if (session_id) {
      const { getSession, upsertChannelBinding } = await import('@/lib/db');
      const session = getSession(session_id);
      if (!session) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
      binding = upsertChannelBinding({
        channelType: 'feishu',
        chatId: chat_id,
        codepilotSessionId: session_id,
        workingDirectory: working_directory || session.working_directory || os.homedir(),
      });
    } else {
      binding = resolve(address);
    }

    // Accumulate streamed response text
    let accumulatedText = '';
    const onPartialText = (fullText: string) => {
      accumulatedText = fullText;
    };

    // Process the message through the conversation engine
    const result = await processMessage(
      binding,
      text,
      undefined,
      undefined,
      undefined,
      onPartialText,
    );

    if (result.hasError) {
      return Response.json(
        { error: result.errorMessage, session_id: binding.codepilotSessionId },
        { status: 500 },
      );
    }

    const responseText = result.responseText || accumulatedText;
    return Response.json({
      response: responseText,
      session_id: binding.codepilotSessionId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/bridge/chat]', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
