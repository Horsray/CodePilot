import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { SkillKind } from "@/types";
import {
  getGlobalCommandsDir,
  getGlobalSkillsDir,
  getProjectCommandsDir,
  getProjectSkillsDir,
} from "@/lib/skills-registry";
import { invalidateSkillCache } from "@/lib/skill-discovery";
import { getSetting, setSetting } from "@/lib/db";

type SkillSource = "global" | "project";
type SkillMatch = {
  filePath: string;
  source: SkillSource;
};

/**
 * Parse YAML front matter from SKILL.md content.
 * Extracts `name` and `description` fields from the --- delimited block.
 */
function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fmMatch) return {};

  const frontMatter = fmMatch[1];
  const lines = frontMatter.split(/\r?\n/);
  const result: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

    if (/^description:\s*\|/.test(line)) {
      const descLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+/.test(lines[j])) {
          descLines.push(lines[j].trim());
        } else {
          break;
        }
      }
      if (descLines.length > 0) {
        result.description = descLines.filter(Boolean).join(" ");
      }
      continue;
    }

    const descMatch = line.match(/^description:\s+(.+)/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
  }
  return result;
}

function findSkillByNameInDirectory(dir: string, name: string, source: SkillSource): SkillMatch | null {
  const pathParts = name.split(":");
  const directCommandPath = path.join(dir, ...pathParts.slice(0, -1), `${pathParts[pathParts.length - 1]}.md`);
  if (fs.existsSync(directCommandPath)) {
    return { filePath: directCommandPath, source };
  }

  if (!fs.existsSync(dir)) {
    return null;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillMdPath = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const meta = parseSkillFrontMatter(content);
    if ((meta.name || entry.name) === name) {
      return { filePath: skillMdPath, source };
    }
  }

  return null;
}

function findSkillFile(name: string, scope?: SkillSource, cwd?: string): SkillMatch | null {
  const candidates: Array<{ dir: string; source: SkillSource }> = [];

  if (!scope || scope === "project") {
    candidates.push({ dir: getProjectCommandsDir(cwd), source: "project" });
    candidates.push({ dir: getProjectSkillsDir(cwd), source: "project" });
  }

  if (!scope || scope === "global") {
    candidates.push({ dir: getGlobalCommandsDir(), source: "global" });
    candidates.push({ dir: getGlobalSkillsDir(), source: "global" });
  }

  for (const candidate of candidates) {
    const match = findSkillByNameInDirectory(candidate.dir, name, candidate.source);
    if (match) {
      return match;
    }
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const url = new URL(_request.url);
    const scopeParam = url.searchParams.get("scope");
    const cwdParam = url.searchParams.get("cwd") || undefined;
    const scope =
      scopeParam === "global" || scopeParam === "project"
        ? (scopeParam as SkillSource)
        : undefined;
    if (scopeParam && !scope) {
      return NextResponse.json(
        { error: "Invalid scope; expected 'global' or 'project'" },
        { status: 400 }
      );
    }

    const found = findSkillFile(name, scope, cwdParam);
    if (!found) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const content = fs.readFileSync(found.filePath, "utf-8");
    const firstLine = content.split("\n")[0]?.trim() || "";
    let description: string;

    if (found.filePath.endsWith("SKILL.md")) {
      const meta = parseSkillFrontMatter(content);
      description = meta.description || (firstLine.startsWith("#") ? firstLine.replace(/^#+\s*/, "") : firstLine || `Skill: /${name}`);
    } else {
      description = firstLine.startsWith("#")
        ? firstLine.replace(/^#+\s*/, "")
        : firstLine || `Skill: /${name}`;
    }

    const kind: SkillKind = found.filePath.endsWith("SKILL.md") ? "agent_skill" : "slash_command";

    return NextResponse.json({
      skill: {
        name,
        description,
        content,
        source: found.source,
        filePath: found.filePath,
        kind,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read skill" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const { content } = body as { content: string };

    const url = new URL(request.url);
    const scopeParam = url.searchParams.get("scope");
    const cwdParam = url.searchParams.get("cwd") || undefined;
    const scope =
      scopeParam === "global" || scopeParam === "project"
        ? (scopeParam as SkillSource)
        : undefined;
    if (scopeParam && !scope) {
      return NextResponse.json(
        { error: "Invalid scope; expected 'global' or 'project'" },
        { status: 400 }
      );
    }

    const found = findSkillFile(name, scope, cwdParam);
    if (!found) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    fs.writeFileSync(found.filePath, content ?? "", "utf-8");
    invalidateSkillCache();

    const firstLine = (content ?? "").split("\n")[0]?.trim() || "";
    const description = firstLine.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "")
      : firstLine || `Skill: /${name}`;

    const kind: SkillKind = found.filePath.endsWith("SKILL.md") ? "agent_skill" : "slash_command";

    return NextResponse.json({
      skill: {
        name,
        description,
        content: content ?? "",
        source: found.source,
        filePath: found.filePath,
        kind,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update skill" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const url = new URL(_request.url);
    const scopeParam = url.searchParams.get("scope");
    const cwdParam = url.searchParams.get("cwd") || undefined;
    const scope =
      scopeParam === "global" || scopeParam === "project"
        ? (scopeParam as SkillSource)
        : undefined;
    if (scopeParam && !scope) {
      return NextResponse.json(
        { error: "Invalid scope; expected 'global' or 'project'" },
        { status: 400 }
      );
    }

    const found = findSkillFile(name, scope, cwdParam);
    if (!found) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    fs.unlinkSync(found.filePath);
    invalidateSkillCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete skill" },
      { status: 500 }
    );
  }
}

// 中文注释：功能名称「技能启用/禁用切换」，用法是通过 PATCH 更新 disabled_skills 列表，
// 让用户在管理面板关闭技能后，AI 全局不可见。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const { disabled } = body as { disabled: boolean };

    const raw = getSetting('disabled_skills') || '[]';
    let disabledList: string[] = [];
    try { disabledList = JSON.parse(raw); } catch { disabledList = []; }

    if (disabled) {
      if (!disabledList.includes(name)) disabledList.push(name);
    } else {
      disabledList = disabledList.filter((n: string) => n !== name);
    }

    setSetting('disabled_skills', JSON.stringify(disabledList));
    invalidateSkillCache();

    return NextResponse.json({ name, disabled, disabledList });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to toggle skill" },
      { status: 500 }
    );
  }
}
