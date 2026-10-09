"use client";

import { useMemo } from "react";
import type { UpdateContextValue } from "@/hooks/useUpdate";

/**
 * Update checker — DISABLED in this fork.
 *
 * The fork owner does not distribute releases and does not sync with
 * upstream, so the in-app "new version available" prompt is permanently
 * off. All exports keep their original signatures so call-sites keep
 * compiling, but every operation is a deliberate no-op:
 *
 *   - No network requests to GitHub Releases.
 *   - No native `window.electronAPI.updater` subscription.
 *   - No periodic polling.
 *   - `showDialog` is always `false`, so `UpdateDialog` never renders.
 *   - `updateInfo` is always `null`, so the side-rail red dot and the
 *     Rosetta / ready-to-install banners stay hidden.
 *
 * If a future build ever needs to re-introduce update notifications,
 * restore the implementation from the `git log` of this file.
 */
export function useUpdateChecker(): UpdateContextValue {
  return useMemo<UpdateContextValue>(
    () => ({
      updateInfo: null,
      checking: false,
      checkForUpdates: async () => {
        // intentionally disabled
      },
      downloadUpdate: () => {
        // intentionally disabled
      },
      dismissUpdate: () => {
        // intentionally disabled
      },
      showDialog: false,
      setShowDialog: () => {
        // intentionally disabled
      },
      quitAndInstall: () => {
        // intentionally disabled
      },
    }),
    [],
  );
}