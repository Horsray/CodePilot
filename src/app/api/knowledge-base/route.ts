import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { SETTING_KEYS } from '@/types';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET() {
  try {
    const workspacePath = getSetting(SETTING_KEYS.ASSISTANT_WORKSPACE_PATH);
    if (!workspacePath) return NextResponse.json({ error: 'Workspace path not configured' }, { status: 400 });

    const graphJsonPath = path.join(workspacePath, 'graphify-out', 'graph.json');
    const graphHtmlPath = path.join(workspacePath, 'graphify-out', 'graph.html');
    const reportMdPath = path.join(workspacePath, 'graphify-out', 'GRAPH_REPORT.md');

    let graphData = null;
    let hasHtml = false;
    let reportMd = '';

    if (fs.existsSync(graphJsonPath)) {
      graphData = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
    }

    if (fs.existsSync(graphHtmlPath)) {
      hasHtml = true;
    }

    if (fs.existsSync(reportMdPath)) {
      reportMd = fs.readFileSync(reportMdPath, 'utf-8');
    }

    return NextResponse.json({ 
      graphData, 
      hasHtml, 
      reportMd,
      workspacePath 
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { action, target } = await req.json();
    const workspacePath = getSetting(SETTING_KEYS.ASSISTANT_WORKSPACE_PATH);
    if (!workspacePath) return NextResponse.json({ error: 'Workspace path not configured' }, { status: 400 });

    if (action === 'learn') {
      // In a real scenario, we might want to run this in a separate process or via the agent loop.
      // For now, let's just trigger the command if target is a path.
      const cmd = `graphify .`; // Always run on current workspace root
      const { stdout, stderr } = await execAsync(cmd, { cwd: workspacePath });
      return NextResponse.json({ success: true, stdout, stderr });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
