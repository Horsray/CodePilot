import { NextRequest, NextResponse } from "next/server";
import {
  appendBrowserSessionLog,
  clearBrowserSessionContext,
  getBrowserSessionContext,
  updateBrowserSessionMeta,
} from "@/lib/browser-context-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  return NextResponse.json({ context: getBrowserSessionContext(sessionId) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, type } = body as {
      sessionId?: string;
      type?: "meta" | "log";
      url?: string;
      title?: string;
      level?: "log" | "info" | "warn" | "error" | "debug";
      message?: string;
      source?: string;
    };

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    if (type === "meta") {
      return NextResponse.json({
        success: true,
        context: updateBrowserSessionMeta(sessionId, {
          url: body.url,
          title: body.title,
        }),
      });
    }

    if (type === "log" && typeof body.message === "string" && body.message.trim()) {
      return NextResponse.json({
        success: true,
        context: appendBrowserSessionLog(sessionId, {
          level: body.level || "log",
          message: body.message,
          source: body.source,
          url: body.url,
        }),
      });
    }

    return NextResponse.json({ error: "Unknown browser context payload" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update browser context";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  clearBrowserSessionContext(sessionId);
  return NextResponse.json({ success: true });
}
