"use client";

import { useState, useCallback } from "react";
import type { GitStashEntry } from "@/types";

export function useGitStash(cwd: string) {
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/stash?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch stashes");
      }
      const data = await res.json();
      setStashes(data.stashes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stashes");
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  return { stashes, loading, error, fetch: fetch_ };
}
