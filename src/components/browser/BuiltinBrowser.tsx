"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowClockwise,
  Globe,
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
  onMetaChange?: (meta: { title?: string; url?: string }) => void;
}

type ElectronWebviewElement = HTMLElement & {
  src: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

function normalizeBrowserUrl(targetUrl: string): string {
  let normalized = targetUrl.trim();
  if (!normalized) return "";
  if (!/^https?:\/\//i.test(normalized)) {
    if (/^localhost(:\d+)?/.test(normalized) || /^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(normalized)) {
      normalized = `http://${normalized}`;
    } else if (normalized.includes(".") && !normalized.includes(" ")) {
      normalized = `https://${normalized}`;
    } else {
      normalized = `http://${normalized}`;
    }
  }
  return normalized;
}

export function BuiltinBrowser({ initialUrl, onMetaChange }: BuiltinBrowserProps) {
  const { t } = useTranslation();
  const initialNormalizedUrl = useMemo(() => normalizeBrowserUrl(initialUrl || ""), [initialUrl]);
  const [url, setUrl] = useState(initialNormalizedUrl);
  const [inputUrl, setInputUrl] = useState(initialNormalizedUrl);
  const [loading, setLoading] = useState(false);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const historyRef = useRef<string[]>(initialNormalizedUrl ? [initialNormalizedUrl] : []);
  const historyIndexRef = useRef(initialNormalizedUrl ? 0 : -1);
  const lastInitialUrlRef = useRef(initialNormalizedUrl);
  const isElectron = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => typeof window !== "undefined" && !!(window as any).electronAPI?.versions?.electron,
    []
  );

  const syncHistoryState = useCallback((nextUrl: string, mode: "push" | "replace" = "push") => {
    if (!nextUrl) return;
    if (mode === "replace") {
      historyRef.current = [nextUrl];
      historyIndexRef.current = 0;
    } else {
      const history = historyRef.current.slice(0, historyIndexRef.current + 1);
      if (history[history.length - 1] !== nextUrl) {
        history.push(nextUrl);
      }
      historyRef.current = history;
      historyIndexRef.current = history.length - 1;
    }
    setCanGoBack(historyIndexRef.current > 0);
    setCanGoForward(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const syncMeta = useCallback((nextUrl: string, title?: string) => {
    onMetaChange?.({
      url: nextUrl,
      title: title || nextUrl,
    });
  }, [onMetaChange]);

  const navigate = useCallback((targetUrl: string) => {
    const normalized = normalizeBrowserUrl(targetUrl);
    if (!normalized) return;

    setUrl(normalized);
    setInputUrl(normalized);
    setLoading(true);
    syncHistoryState(normalized);
    syncMeta(normalized);

    // Explicitly load URL when user submits
    if (isElectron && webviewRef.current) {
      webviewRef.current.src = normalized;
    } else if (!isElectron && iframeRef.current) {
      iframeRef.current.src = normalized;
    }
  }, [syncHistoryState, syncMeta, isElectron]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigate(inputUrl);
  }, [inputUrl, navigate]);

  const handleGoBack = useCallback(() => {
    if (isElectron && webviewRef.current?.canGoBack()) {
      webviewRef.current.goBack();
      return;
    }
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const prevUrl = historyRef.current[historyIndexRef.current];
      setUrl(prevUrl);
      setInputUrl(prevUrl);
      setCanGoBack(historyIndexRef.current > 0);
      setCanGoForward(true);
      syncMeta(prevUrl);

      if (!isElectron && iframeRef.current) {
        iframeRef.current.src = prevUrl;
      }
    }
  }, [isElectron, syncMeta]);

  const handleGoForward = useCallback(() => {
    if (isElectron && webviewRef.current?.canGoForward()) {
      webviewRef.current.goForward();
      return;
    }
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextUrl = historyRef.current[historyIndexRef.current];
      setUrl(nextUrl);
      setInputUrl(nextUrl);
      setCanGoBack(true);
      setCanGoForward(historyIndexRef.current < historyRef.current.length - 1);
      syncMeta(nextUrl);

      if (!isElectron && iframeRef.current) {
        iframeRef.current.src = nextUrl;
      }
    }
  }, [isElectron, syncMeta]);

  const handleRefresh = useCallback(() => {
    if (!url) return;
    if (isElectron && webviewRef.current) {
      setLoading(true);
      webviewRef.current.reload();
      return;
    }
    if (iframeRef.current) {
      setLoading(true);
      iframeRef.current.src = url;
    }
  }, [isElectron, url]);

  const handleOpenExternal = useCallback(() => {
    if (url) {
      window.open(url, "_blank");
    }
  }, [url]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    if (url) syncMeta(url);
  }, [syncMeta, url]);

  useEffect(() => {
    if (!isElectron || !webviewRef.current) return;
    const webview = webviewRef.current;

    const syncNavState = (nextUrl: string, title?: string) => {
      setLoading(false);
      // Only sync if URL has actually changed to avoid loop
      if (nextUrl && nextUrl !== url && nextUrl !== url + '/' && url !== nextUrl + '/') {
        setUrl(nextUrl);
        setInputUrl(nextUrl);
        syncHistoryState(nextUrl);
      }
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      syncMeta(nextUrl, title);
    };

    const handleDidStartLoading = () => {
      setLoading(true);
    };
    const handleDidStopLoading = () => {
      setLoading(false);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };
    const handleDidNavigate = (event: Event) => {
      const nextUrl = (event as Event & { url?: string }).url;
      // Some navigations are internal or about:blank, ignore them
      if (!nextUrl || nextUrl === 'about:blank') return;
      syncNavState(nextUrl);
    };
    const handleTitleUpdated = (event: Event) => {
      const nextTitle = (event as Event & { title?: string }).title;
      const nextUrl = webview.src || url;
      syncMeta(nextUrl, nextTitle);
    };
    const handleConsoleMessage = (event: Event) => {
      const detail = event as Event & { message?: string; level?: number };
      const levelMap = ["log", "info", "warn", "error"] as const;
      const mappedLevel = levelMap[Math.min(Math.max((detail.level || 0) - 1, 0), 3)] || "log";
      window.dispatchEvent(new CustomEvent("console-log", {
        detail: {
          level: mappedLevel,
          message: detail.message || "",
          source: "browser",
        },
      }));
    };

    webview.addEventListener("did-start-loading", handleDidStartLoading);
    webview.addEventListener("did-stop-loading", handleDidStopLoading);
    webview.addEventListener("did-navigate", handleDidNavigate);
    webview.addEventListener("did-navigate-in-page", handleDidNavigate);
    webview.addEventListener("page-title-updated", handleTitleUpdated);
    webview.addEventListener("console-message", handleConsoleMessage);

    return () => {
      webview.removeEventListener("did-start-loading", handleDidStartLoading);
      webview.removeEventListener("did-stop-loading", handleDidStopLoading);
      webview.removeEventListener("did-navigate", handleDidNavigate);
      webview.removeEventListener("did-navigate-in-page", handleDidNavigate);
      webview.removeEventListener("page-title-updated", handleTitleUpdated);
      webview.removeEventListener("console-message", handleConsoleMessage);
    };
  }, [isElectron, syncHistoryState, syncMeta, url]);


  useEffect(() => {
    if (initialNormalizedUrl) {
      syncMeta(initialNormalizedUrl);
    }
  }, [initialNormalizedUrl, syncMeta]);

  useEffect(() => {
    if (initialNormalizedUrl === lastInitialUrlRef.current) return;
    lastInitialUrlRef.current = initialNormalizedUrl;
    
    // CRITICAL: We MUST not setUrl or setInputUrl here if the url is exactly the same,
    // otherwise the iframe will unmount and remount endlessly, causing the flickering issue.
    setUrl((prev) => {
      if (prev === initialNormalizedUrl || prev + '/' === initialNormalizedUrl || initialNormalizedUrl + '/' === prev) {
        return prev;
      }
      return initialNormalizedUrl;
    });
    setInputUrl((prev) => {
      if (prev === initialNormalizedUrl || prev + '/' === initialNormalizedUrl || initialNormalizedUrl + '/' === prev) {
        return prev;
      }
      return initialNormalizedUrl;
    });
    
    if (initialNormalizedUrl) {
      setLoading(true);
      syncHistoryState(initialNormalizedUrl, "replace");
      syncMeta(initialNormalizedUrl);

      // Force load the initial URL if it genuinely changes
      if (isElectron && webviewRef.current) {
        webviewRef.current.src = initialNormalizedUrl;
      } else if (!isElectron && iframeRef.current) {
        iframeRef.current.src = initialNormalizedUrl;
      }
    } else {
      setLoading(false);
      historyRef.current = [];
      historyIndexRef.current = -1;
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }, [initialNormalizedUrl, syncHistoryState, syncMeta, isElectron]);

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
              placeholder={t('browser.urlPlaceholder') || 'Enter URL...'}
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
            {isElectron ? (
              <webview
                ref={(node) => {
                  webviewRef.current = node as ElectronWebviewElement | null;
                }}
                className="w-full h-full border-0 bg-background"
                partition="persist:codepilot-browser"
                src={initialNormalizedUrl || "about:blank"}
              />
            ) : (
              <iframe
                ref={iframeRef}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                onLoad={handleIframeLoad}
                title={t('browser.preview') || 'Preview'}
                src={initialNormalizedUrl || "about:blank"}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/60 gap-3">
            <Globe size={40} />
            <p className="text-sm">{t('browser.empty') || 'No URL specified'}</p>
            <p className="text-xs text-muted-foreground/40">{t('browser.emptyHint') || 'Enter a URL to start browsing'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
