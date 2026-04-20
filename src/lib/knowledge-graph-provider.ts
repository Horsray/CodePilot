/**
 * KnowledgeGraphProvider — The orchestrator for the Knowledge Graph system.
 * 
 * It coordinates graphify (for structural extraction) and mcp__memory__ (for dynamic storage).
 * 中文：知识图谱系统的协调者，负责 graphify（结构化提取）和 mcp__memory__（动态存储）的协同。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { memoryClient } from './memory-client';

const execAsync = promisify(exec);

export class KnowledgeGraphProvider {
  /**
   * Triggers the "Learn" process: Extraction -> Sync.
   * 中文：触发“学习”流程：提取 -> 同步。
   */
  async learn(workspacePath: string) {
    console.log(`[KnowledgeGraphProvider] Starting learn in ${workspacePath}`);
    
    // 1. Run graphify to extract structural knowledge
    // Using --update for incremental learning and --mcp if supported by the skill
    const cmd = `graphify . --update`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: workspacePath });
      console.log(`[KnowledgeGraphProvider] graphify stdout: ${stdout}`);
      if (stderr) console.warn(`[KnowledgeGraphProvider] graphify stderr: ${stderr}`);
    } catch (err) {
      console.error(`[KnowledgeGraphProvider] graphify execution failed:`, err);
      throw new Error(`Failed to extract knowledge: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Read the resulting graph.json
    const graphJsonPath = path.join(workspacePath, 'graphify-out', 'graph.json');
    if (!fs.existsSync(graphJsonPath)) {
      throw new Error('graphify-out/graph.json not found after learning. Check if graphify is installed and working.');
    }

    let graphData;
    try {
      graphData = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
    } catch (err) {
      throw new Error(`Failed to parse graph.json: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // [Phase 1: Consolidation]
    // Removed syncToMcp(graphData) here to prevent static AST nodes from polluting
    // the dynamic MCP Memory database. Graphify output should be used purely as a 
    // read-only structural reference, while MCP Memory is reserved for dynamic 
    // business logic, architectural decisions, and user preferences.
    console.log(`[KnowledgeGraphProvider] Learn complete. Graph data available at graphify-out/graph.json`);
    
    return graphData;
  }

  /**
   * Syncs graphify nodes and links to the MCP Memory server.
   * 中文：将 graphify 的节点和链接同步到 MCP 记忆服务器。
   * @deprecated Removed in Hermes Unified Memory System update to prevent data pollution.
   */
  private async syncToMcp(graphData: any) {
    console.warn(`[KnowledgeGraphProvider] syncToMcp is deprecated and has been disabled to prevent MCP Memory pollution.`);
    return;
  }

  /**
   * Returns the current graph state.
   * 中文：返回当前图谱状态。
   */
  async getGraph(workspacePath: string) {
    const graphJsonPath = path.join(workspacePath, 'graphify-out', 'graph.json');
    if (fs.existsSync(graphJsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
      } catch (e) {
        console.error(`[KnowledgeGraphProvider] Failed to read graph.json:`, e);
      }
    }
    return { nodes: [], links: [] };
  }
}

export const knowledgeGraphProvider = new KnowledgeGraphProvider();
