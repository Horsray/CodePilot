import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  discoverEffectiveSkillFiles,
  getGlobalCommandsDir,
  getProjectCommandsDir,
} from "@/lib/skills-registry";
import { invalidateSkillCache } from "@/lib/skill-discovery";
import { getSetting } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    // Accept optional cwd query param for project-level skills
    const cwd = request.nextUrl.searchParams.get("cwd") || undefined;

    // Resolve provider ID from session for correct capability cache lookup.
    // Falls back to 'env' when no session is specified.
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    let providerId = 'env';
    if (sessionId) {
      try {
        const { getSession } = await import('@/lib/db');
        const session = getSession(sessionId);
        providerId = session?.provider_id || 'env';
      } catch {
        // DB not available, fall back to 'env'
      }
    }
    let loadedPluginPaths: Set<string> | null = null;
    try {
      const { getCachedPlugins } = await import('@/lib/agent-sdk-capabilities');
      const loaded = getCachedPlugins(providerId);
      loadedPluginPaths = new Set(loaded.map(p => p.path));
    } catch {
      // SDK capabilities not available
    }
    const all = discoverEffectiveSkillFiles({ cwd, loadedPluginPaths });

    // Merge SDK slash commands if available
    try {
      const { getCachedCommands } = await import('@/lib/agent-sdk-capabilities');
      const sdkCommands = getCachedCommands(providerId);
      if (sdkCommands.length > 0) {
        const existingNames = new Set(all.map(s => s.name));
        for (const cmd of sdkCommands) {
          if (!existingNames.has(cmd.name)) {
            all.push({
              name: cmd.name,
              description: cmd.description || `SDK command: /${cmd.name}`,
              content: '', // SDK commands don't have local content
              source: 'sdk',
              kind: 'sdk_command',
              filePath: '',
            });
          }
        }
        console.log(`[skills] Added ${sdkCommands.length} SDK commands (${sdkCommands.filter(c => !existingNames.has(c.name)).length} unique)`);
      }
    } catch {
      // SDK capabilities not available, skip
    }

    // 中文注释：读取 disabled_skills 设置，为每个技能标注启用/禁用状态
    let disabledSet: Set<string> = new Set();
    try {
      const raw = getSetting('disabled_skills') || '[]';
      const list = JSON.parse(raw);
      if (Array.isArray(list)) disabledSet = new Set(list.map((s: string) => s.toLowerCase()));
    } catch { /* ignore parse errors */ }

    const annotated = all.map(s => ({
      ...s,
      disabled: disabledSet.has(s.name.toLowerCase()),
    }));

    return NextResponse.json({ skills: annotated });
  } catch (error) {
    console.error('[skills] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load skills" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, content, scope, cwd } = body as {
      name: string;
      content: string;
      scope: "global" | "project";
      cwd?: string;
    };

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Skill name is required" },
        { status: 400 }
      );
    }

    // Sanitize name: allow alphanumeric, hyphens, underscores, and CJK characters
    const safeName = name.replace(/[^一-鿿㐀-䶿a-zA-Z0-9_-]/g, "-");
    if (!safeName) {
      return NextResponse.json(
        { error: "Invalid skill name" },
        { status: 400 }
      );
    }

    // 中文注释：功能名称「技能创建落盘」，用法是默认写入 Claude 全局命令目录；
    // 只有用户显式选择项目范围时，才写入当前项目 `.claude/commands`。
    const dir = scope === "project" ? getProjectCommandsDir(cwd) : getGlobalCommandsDir();

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${safeName}.md`);
    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "A skill with this name already exists" },
        { status: 409 }
      );
    }

    fs.writeFileSync(filePath, content || "", "utf-8");
    invalidateSkillCache();

    const firstLine = (content || "").split("\n")[0]?.trim() || "";
    const description = firstLine.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "")
      : firstLine || `Skill: /${safeName}`;

    return NextResponse.json(
      {
        skill: {
          name: safeName,
          description,
          content: content || "",
          source: scope || "global",
          filePath,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create skill" },
      { status: 500 }
    );
  }
}
