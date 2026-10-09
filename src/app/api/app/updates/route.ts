import { NextResponse } from "next/server";
import { getRuntimeArchitectureInfo } from "@/lib/platform";

function noUpdatePayload(
  currentVersion: string,
  runtimeInfo: ReturnType<typeof getRuntimeArchitectureInfo>,
) {
  return {
    latestVersion: currentVersion,
    currentVersion,
    updateAvailable: false,
    releaseName: "",
    releaseNotes: "",
    publishedAt: "",
    releaseUrl: "",
    downloadUrl: "",
    downloadAssetName: "",
    detectedPlatform: runtimeInfo.platform,
    detectedArch: runtimeInfo.processArch,
    hostArch: runtimeInfo.hostArch,
    runningUnderRosetta: runtimeInfo.runningUnderRosetta,
  };
}

/**
 * GET /api/app/updates — DISABLED in this fork.
 *
 * The fork owner does not ship releases and does not sync with upstream,
 * so we never query the GitHub Releases endpoint. The response always
 * reports "no update available" so any leftover frontend polling remains
 * a no-op.
 *
 * `update-release.ts` (asset selection helpers) are unused here now but
 * kept on disk because some legacy imports still reference the type.
 */
export async function GET() {
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
  const runtimeInfo = getRuntimeArchitectureInfo();
  return NextResponse.json(noUpdatePayload(currentVersion, runtimeInfo));
}