import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ContextCompressionWidget } from "./ContextCompressionWidget";
import type { Message } from "@/types";

interface ContextWidgetPortalProps {
  messages: Message[];
  modelName: string;
  context1m?: boolean;
  hasSummary?: boolean;
  contextWindow?: number;
  upstreamModelId?: string;
  toolFiles?: string[];
  onCompress?: () => void;
}

export function ContextWidgetPortal(props: ContextWidgetPortalProps) {
  const [container, setContainer] = useState<Element | null>(null);

  useEffect(() => {
    const el = document.getElementById("dashboard-context-slot");
    setContainer(el);
  }, []);

  if (!container) return null;

  return createPortal(<ContextCompressionWidget {...props} />, container);
}
