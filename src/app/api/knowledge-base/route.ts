import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { SETTING_KEYS } from '@/types';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    
    const workspacePath = getSetting(SETTING_KEYS.ASSISTANT_WORKSPACE_PATH);
    if (!workspacePath) return NextResponse.json({ error: 'Workspace path not configured' }, { status: 400 });

    if (mode === 'graph') {
      const graphHtmlPath = path.join(workspacePath, 'graphify-out', 'graph.html');
      if (fs.existsSync(graphHtmlPath)) {
        const content = fs.readFileSync(graphHtmlPath, 'utf-8');
        return new NextResponse(content, { headers: { 'Content-Type': 'text/html' } });
      }
      return new NextResponse('Graph not generated yet.', { status: 404 });
    }

    const graphJsonPath = path.join(workspacePath, 'graphify-out', 'graph.json');
    const reportMdPath = path.join(workspacePath, 'graphify-out', 'GRAPH_REPORT.md');

    let graphData = null;
    let reportMd = '';

    if (fs.existsSync(graphJsonPath)) {
      graphData = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
    }

    if (fs.existsSync(reportMdPath)) {
      reportMd = fs.readFileSync(reportMdPath, 'utf-8');
    }

    // Fallback: If no graphify data, look for skills or other knowledge files
    if (!graphData || graphData.nodes?.length === 0) {
      const knowledgeDirs = ['skills', 'docs', 'knowledge', 'specs', 'architecture', 'notes', 'reference', 'manuals'];
      const nodes: any[] = [];
      
      // 1. Check common directories
      for (const dirName of knowledgeDirs) {
        const dirPath = path.join(workspacePath, dirName);
        if (fs.existsSync(dirPath)) {
          try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
              if (file.endsWith('.md')) {
                const fullPath = path.join(dirPath, file);
                const content = fs.readFileSync(fullPath, 'utf-8');
                nodes.push({
                  id: fullPath,
                  label: file.replace('.md', ''),
                  type: 'file',
                  level: dirName.toUpperCase(),
                  description: content.slice(0, 200).replace(/[\r\n]/g, ' ') + '...',
                  path: fullPath
                });
              }
            }
          } catch (e) { /* ignore */ }
        }
      }

      // 2. Check root for other .md files (excluding common ones)
      const exclude = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'RULES.md'];
      try {
        const rootFiles = fs.readdirSync(workspacePath);
        for (const file of rootFiles) {
          if (file.endsWith('.md') && !exclude.includes(file)) {
            const fullPath = path.join(workspacePath, file);
            const content = fs.readFileSync(fullPath, 'utf-8');
            nodes.push({
              id: fullPath,
              label: file.replace('.md', ''),
              type: 'file',
              level: 'GENERAL',
              description: content.slice(0, 200).replace(/[\r\n]/g, ' ') + '...',
              path: fullPath
            });
          }
        }
      } catch (e) { /* ignore */ }
      
      if (nodes.length > 0) {
        graphData = { nodes };
      }
    } else {
      // Enhance graphify nodes with real paths if they are local files
      graphData.nodes = graphData.nodes.map((n: any) => {
        if (n.type === 'file' && !n.path) {
          const possiblePath = path.join(workspacePath, n.id);
          if (fs.existsSync(possiblePath)) {
            n.path = possiblePath;
          }
        }
        return n;
      });
    }

    return NextResponse.json({ 
      graphData, 
      reportMd,
      workspacePath 
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { action, target, fileName, content } = await req.json();
    const workspacePath = getSetting(SETTING_KEYS.ASSISTANT_WORKSPACE_PATH);
    if (!workspacePath) return NextResponse.json({ error: 'Workspace path not configured' }, { status: 400 });

    if (action === 'learn') {
      const cmd = `graphify .`;
      const { stdout, stderr } = await execAsync(cmd, { cwd: workspacePath });
      return NextResponse.json({ success: true, stdout, stderr });
    }

    if (action === 'upload') {
      const destDir = path.join(workspacePath, 'knowledge');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      
      const destPath = path.join(destDir, fileName);
      fs.writeFileSync(destPath, content, 'utf-8');
      return NextResponse.json({ success: true, path: destPath });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
