'use client';

import { useState, useCallback, useRef } from 'react';

export interface PromptOptimizeResult {
  original: string;
  optimized: string;
}

export interface UsePromptOptimizeReturn {
  isOptimizing: boolean;
  error: string | null;
  optimize: (prompt: string, language?: 'zh' | 'en') => Promise<PromptOptimizeResult | null>;
  cancel: () => void;
}

export function usePromptOptimize(): UsePromptOptimizeReturn {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const optimize = useCallback(async (
    prompt: string,
    language: 'zh' | 'en' = 'zh'
  ): Promise<PromptOptimizeResult | null> => {
    // Cancel any existing request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsOptimizing(true);
    setError(null);

    try {
      const res = await fetch('/api/prompt-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, language }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }

      const result: PromptOptimizeResult = await res.json();
      return result;
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }

      const message = err instanceof Error ? err.message : 'Failed to optimize prompt';
      setError(message);
      return null;
    } finally {
      if (!abortRef.current || abortRef.current === controller) {
        setIsOptimizing(false);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsOptimizing(false);
    }
  }, []);

  return {
    isOptimizing,
    error,
    optimize,
    cancel,
  };
}
