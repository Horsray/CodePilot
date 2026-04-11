import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

/**
 * API to write content to a file.
 * Used for editing files from the UI (Rule files, KB files, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath, content } = body;

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing required field: path" },
        { status: 400 }
      );
    }

    // Security: prevent path traversal
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // Check if file exists (optional, but good practice)
    try {
      await fs.access(normalizedPath);
    } catch {
      return NextResponse.json({ error: "File does not exist" }, { status: 404 });
    }

    // Write content
    await fs.writeFile(normalizedPath, content || "", "utf-8");

    return NextResponse.json({ success: true, path: normalizedPath });
  } catch (error) {
    console.error("Write file error:", error);
    return NextResponse.json(
      { error: "Failed to write file content" },
      { status: 500 }
    );
  }
}
