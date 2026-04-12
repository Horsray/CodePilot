import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { SETTING_KEYS } from '@/types';
import fs from 'fs';
import path from 'path';
import { knowledgeGraphProvider } from '@/lib/knowledge-graph-provider';

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

    const reportMdPath = path.join(workspacePath, 'graphify-out', 'GRAPH_REPORT.md');
    let reportMd = '';
    if (fs.existsSync(reportMdPath)) {
      reportMd = fs.readFileSync(reportMdPath, 'utf-8');
    }

    // Use the provider to get the unified graph data
    const graphData = await knowledgeGraphProvider.getGraph(workspacePath);
    const nodes: any[] = graphData?.nodes || [];
    const links: any[] = graphData?.links || [];

    // Scan directories for potential knowledge (Source of Truth for files)
    const scanDirs = ['knowledge', 'skills', 'docs', 'reference', 'manuals'];
    const excludeFiles = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'RULES.md', 'RELEASE_NOTES.md'];

    const addFileNode = (fullPath: string, relativePath: string, category: string) => {
      // Check if this file is already in the graphify nodes (either by id or path)
      const existingNode = nodes.find(n => n.id === fullPath || n.path === fullPath || n.id === relativePath);
      
      if (!existingNode) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          nodes.push({
            id: relativePath,
            label: path.basename(fullPath).replace('.md', ''),
            type: 'file',
            level: category.toUpperCase(),
            description: content.slice(0, 200).replace(/[\r\n]/g, ' ') + '...',
            path: fullPath,
            status: 'unindexed' // Mark as not yet processed by graphify
          });
        } catch (e) { /* skip inaccessible */ }
      } else {
        // Enrich existing node with absolute path if missing
        if (!existingNode.path) {
          existingNode.path = fullPath;
        }
      }
    };

    // Recursive scan helper
    const scanRecursive = (dir: string, baseDir: string, category: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanRecursive(fullPath, baseDir, category);
        } else if (entry.isFile() && entry.name.endsWith('.md') && !excludeFiles.includes(entry.name)) {
          addFileNode(fullPath, relativePath, category);
        }
      }
    };

    // Run scans
    for (const dirName of scanDirs) {
      scanRecursive(path.join(workspacePath, dirName), workspacePath, dirName);
    }
    // Also scan root .md files
    const rootFiles = fs.readdirSync(workspacePath, { withFileTypes: true });
    for (const f of rootFiles) {
      if (f.isFile() && f.name.endsWith('.md') && !excludeFiles.includes(f.name)) {
        addFileNode(path.join(workspacePath, f.name), f.name, 'GENERAL');
      }
    }

    // Final graphData construction
    const finalGraphData = {
      nodes: nodes.map((n: any) => {
        // Final path normalization
        if (n.type === 'file' && !n.path) {
          const possiblePath = path.isAbsolute(n.id) ? n.id : path.join(workspacePath, n.id);
          if (fs.existsSync(possiblePath)) {
            n.path = possiblePath;
          }
        }
        return n;
      }),
      links
    };

    return NextResponse.json({ 
      graphData: finalGraphData, 
      reportMd,
      workspacePath 
    });
  } catch (err) {
    console.error(`[KB API] GET Error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { action, target, fileName, content } = await req.json();
    const workspacePath = getSetting(SETTING_KEYS.ASSISTANT_WORKSPACE_PATH);
    if (!workspacePath) return NextResponse.json({ error: 'Workspace path not configured' }, { status: 400 });

    if (action === 'learn') {
      // Use the new KnowledgeGraphProvider which handles extraction AND sync to MCP Memory
      const graphData = await knowledgeGraphProvider.learn(workspacePath);
      return NextResponse.json({ success: true, nodeCount: graphData?.nodes?.length });
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
    console.error(`[KB API] POST Error:`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
