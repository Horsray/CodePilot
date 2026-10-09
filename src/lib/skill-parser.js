/**
 * skill-parser.ts — Parse SKILL.md files (YAML frontmatter + Markdown body).
 *
 * Compatible with Claude Code's skill format. Parses all execution-semantic
 * fields (allowed-tools, context, when_to_use, arguments, etc.) not just
 * name + description.
 */
/**
 * Parse a SKILL.md file content into a SkillDefinition.
 */
export function parseSkillFile(content, filePath) {
    const { frontmatter, body } = splitFrontmatter(content);
    return {
        name: String(frontmatter.name || '') || fileNameToSkillName(filePath),
        description: String(frontmatter.description || ''),
        body: body.trim(),
        allowedTools: parseStringArray(frontmatter['allowed-tools']),
        whenToUse: String(frontmatter['when_to_use'] || frontmatter.when_to_use || '') || undefined,
        context: frontmatter.context === 'fork' ? 'fork' : 'inline',
        arguments: parseArguments(frontmatter.arguments),
        model: frontmatter.model ? String(frontmatter.model) : undefined,
        effort: frontmatter.effort ? String(frontmatter.effort) : undefined,
        userInvocable: frontmatter['user-invocable'] !== false,
        filePath,
    };
}
function splitFrontmatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content };
    }
    const yamlStr = match[1];
    const body = match[2];
    // Simple YAML parser (handles key: value, key: [array], nested objects)
    const frontmatter = {};
    for (const line of yamlStr.split('\n')) {
        const kvMatch = line.match(/^(\S[\w-]*)\s*:\s*(.*)$/);
        if (!kvMatch)
            continue;
        const [, key, rawValue] = kvMatch;
        const value = rawValue.trim();
        if (value.startsWith('[') && value.endsWith(']')) {
            // Inline array: [Read, Write, Edit]
            frontmatter[key] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
        else if (value === 'true') {
            frontmatter[key] = true;
        }
        else if (value === 'false') {
            frontmatter[key] = false;
        }
        else if (value === '' || value === '~' || value === 'null') {
            frontmatter[key] = undefined;
        }
        else {
            frontmatter[key] = value;
        }
    }
    return { frontmatter, body };
}
function parseStringArray(value) {
    if (Array.isArray(value))
        return value.map(String);
    if (typeof value === 'string')
        return value.split(',').map(s => s.trim()).filter(Boolean);
    return [];
}
function parseArguments(value) {
    if (!Array.isArray(value))
        return [];
    return value.map(arg => {
        if (typeof arg === 'string')
            return { name: arg };
        if (arg && typeof arg === 'object') {
            return {
                name: String(arg.name || ''),
                description: arg.description,
                required: arg.required,
            };
        }
        return { name: String(arg) };
    }).filter(a => a.name);
}
function fileNameToSkillName(filePath) {
    const base = filePath.split('/').pop() || '';
    return base.replace(/\.(md|skill)$/i, '').replace(/[-_]/g, ' ');
}
