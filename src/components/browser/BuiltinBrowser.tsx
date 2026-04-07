"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowClockwise,
  Globe,
  X,
  ArrowSquareOut,
  DeviceMobile,
  Desktop,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

type DeviceMode = "desktop" | "mobile";

const DEVICE_WIDTHS: Record<DeviceMode, string> = {
  desktop: "100%",
  mobile: "375px",
};

interface BuiltinBrowserProps {
  initialUrl?: string;
}

export function BuiltinBrowser({ initialUrl }: BuiltinBrowserProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initialUrl || "");
  const [inputUrl, setInputUrl] = useState(initialUrl || "");
  const [loading, setLoading] = useState(false);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const navigate = useCallback((targetUrl: string) => {
    let normalized = targetUrl.trim();
    if (!normalized) return;

    // Auto-add protocol
    if (!/^https?:\/\//i.test(normalized)) {
      // Check if it looks like a URL
      if (/^localhost(:\d+)?/.test(normalized) || /^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(normalized)) {
        normalized = `http://${normalized}`;
      } else if (normalized.includes(".") && !normalized.includes(" ")) {
        normalized = `https://${normalized}`;
      } else {
        // Treat as search? Just prefix with http
        normalized = `http://${normalized}`;
      }
    }

    setUrl(normalized);
    setInputUrl(normalized);
    setLoading(true);

    // Update history
    const history = historyRef.current;
    const idx = historyIndexRef.current;
    // Trim forward history
    historyRef.current = history.slice(0, idx + 1);
    historyRef.current.push(normalized);
    historyIndexRef.current = historyRef.current.length - 1;
    setCanGoBack(historyIndexRef.current > 0);
    setCanGoForward(false);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigate(inputUrl);
  }, [inputUrl, navigate]);

  const handleGoBack = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const prevUrl = historyRef.current[historyIndexRef.current];
      setUrl(prevUrl);
      setInputUrl(prevUrl);
      setCanGoBack(historyIndexRef.current > 0);
      setCanGoForward(true);
    }
  }, []);

  const handleGoForward = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextUrl = historyRef.current[historyIndexRef.current];
      setUrl(nextUrl);
      setInputUrl(nextUrl);
      setCanGoBack(true);
      setCanGoForward(historyIndexRef.current < historyRef.current.length - 1);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current && url) {
      setLoading(true);
      iframeRef.current.src = url;
    }
  }, [url]);

  const handleOpenExternal = useCallback(() => {
    if (url) {
      window.open(url, "_blank");
    }
  }, [url]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  // Navigate to initial URL on mount
  useEffect(() => {
    if (initialUrl) {
      navigate(initialUrl);
    }
  }, [initialUrl, navigate]);

  // Listen for browser-navigate events (from preview prompt)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.url) {
        navigate(detail.url);
      }
    };
    window.addEventListener("browser-navigate", handler);
    return () => window.removeEventListener("browser-navigate", handler);
  }, [navigate]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-9 border-b border-border/40 shrink-0">
        {/* Navigation buttons */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleGoBack}
          disabled={!canGoBack}
          className="text-muted-foreground"
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleGoForward}
          disabled={!canGoForward}
          className="text-muted-foreground"
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRefresh}
          disabled={!url}
          className="text-muted-foreground"
        >
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
        </Button>

        {/* URL bar */}
        <form onSubmit={handleSubmit} className="flex-1 mx-1">
          <div className="flex items-center gap-1.5 h-6 rounded-md bg-muted/50 border border-border/40 px-2">
            <Globe size={12} className="text-muted-foreground/60 shrink-0" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder={t('browser.urlPlaceholder')}
              className="flex-1 bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground/50"
              spellCheck={false}
            />
            {loading && (
              <div className="h-3 w-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin shrink-0" />
            )}
          </div>
        </form>

        {/* Device mode toggle */}
        <Button
          variant={deviceMode === "desktop" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => setDeviceMode("desktop")}
          className="text-muted-foreground"
        >
          <Desktop size={14} />
        </Button>
        <Button
          variant={deviceMode === "mobile" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => setDeviceMode("mobile")}
          className="text-muted-foreground"
        >
          <DeviceMobile size={14} />
        </Button>

        {/* Open in external browser */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleOpenExternal}
          disabled={!url}
          className="text-muted-foreground"
        >
          <ArrowSquareOut size={14} />
        </Button>
      </div>

      {/* Browser viewport */}
      <div className="flex-1 min-h-0 flex items-start justify-center overflow-auto bg-muted/20">
        {url ? (
          <div
            className="h-full transition-all duration-200"
            style={{
              width: DEVICE_WIDTHS[deviceMode],
              maxWidth: "100%",
              margin: deviceMode === "mobile" ? "0 auto" : undefined,
            }}
          >
            <iframe
              ref={iframeRef}
              src={url}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={handleIframeLoad}
              title={t('browser.preview')}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 gap-3">
            <Globe size={40} />
            <p className="text-sm">{t('browser.empty')}</p>
            <p className="text-xs text-muted-foreground/40">{t('browser.emptyHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
