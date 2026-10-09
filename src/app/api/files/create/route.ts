import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath, type } = body;

    if (!filePath || !type) {
      return NextResponse.json(
        { error: "Missing required fields: path and type" },
        { status: 400 }
      );
    }

    if (type !== "file" && type !== "directory") {
      return NextResponse.json(
        { error: "Invalid type. Must be 'file' or 'directory'" },
        { status: 400 }
      );
    }

    // Security: prevent path traversal
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const parentDir = path.dirname(normalizedPath);
    await fs.mkdir(parentDir, { recursive: true });

    if (type === "directory") {
      await fs.mkdir(normalizedPath, { recursive: true });
    } else {
      // Check if file exists
      try {
        await fs.access(normalizedPath);
        return NextResponse.json({ error: "File already exists" }, { status: 409 });
      } catch {
        // File doesn't exist, which is what we want
      }
      await fs.writeFile(normalizedPath, "", "utf-8");
    }

    return NextResponse.json({ success: true, path: normalizedPath });
  } catch (error) {
    console.error("Create file error:", error);
    return NextResponse.json(
      { error: "Failed to create file or directory" },
      { status: 500 }
    );
  }
}
