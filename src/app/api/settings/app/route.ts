import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, getDb } from '@/lib/db';
import fs from 'fs';
import path from 'path';

/**
 * CodePilot app-level settings (stored in SQLite, separate from ~/.claude/settings.json).
 * Used for API configuration (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, etc.)
 */

const ALLOWED_KEYS = [
  'anthropic_auth_token',
  'anthropic_base_url',
  'dangerously_skip_permissions',
  'generative_ui_enabled',
  'locale',
  'thinking_mode',
  'theme_mode',
  'theme_family',
  'default_panel',
  'max_thinking_tokens',
  'assistant_workspace_path',
  'include_agents_md',
  'include_claude_md',
  'enable_agents_skills',
  'sync_project_rules',
  'knowledge_base_enabled',
  // Feature announcement dismiss flags (persist across Electron restarts)
  'codepilot:announcement:v0.48-agent-engine',
  'lang_opt_provider_id',
  'lang_opt_model',
  'nightly_compaction_enabled',
  'nightly_compaction_provider_id',
  'nightly_compaction_model',
  // JSON array of disabled skill names (e.g. '["skill-a","skill-b"]')
  // Users toggle skills in the Skills Manager UI; disabled skills are hidden from AI globally
  'disabled_skills',
];

export async function GET() {
  try {
    const result: Record<string, string> = {};
    for (const key of ALLOWED_KEYS) {
      const value = getSetting(key);
      if (value !== undefined) {
        // Mask token for security (only return last 8 chars)
        if (key === 'anthropic_auth_token' && value.length > 8) {
          result[key] = '***' + value.slice(-8);
        } else {
          result[key] = value;
        }
      }
    }

    // Discover project rules if sync is enabled
    if (result.sync_project_rules !== 'false') {
      try {
        const db = getDb();
        const sessions = db.prepare('SELECT DISTINCT working_directory FROM chat_sessions WHERE working_directory IS NOT NULL').all() as any[];
        const roots = sessions.map(s => s.working_directory);
        
        const discovered = [];
        for (const root of roots) {
          const rulePath = path.join(root, '.trae/rules/rules.md');
          if (fs.existsSync(rulePath)) {
            try {
              const content = fs.readFileSync(rulePath, 'utf-8');
              discovered.push({
                projectName: path.basename(root),
                path: rulePath,
                content: content.slice(0, 500) // Only return preview
              });
            } catch (e) {
              // ignore
            }
          }
        }
        result['discovered_project_rules'] = JSON.stringify(discovered);
      } catch (e) {
        console.error('Failed to discover project rules:', e);
      }
    }

    return NextResponse.json({ settings: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read app settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      const strValue = String(value ?? '').trim();
      if (strValue) {
        // Don't overwrite token if user sent the masked version back
        if (key === 'anthropic_auth_token' && strValue.startsWith('***')) {
          continue;
        }
        setSetting(key, strValue);
      } else {
        // Empty value = remove the setting
        setSetting(key, '');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save app settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
