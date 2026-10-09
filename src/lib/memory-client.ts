/**
 * MemoryClient — Low-level client for interacting with the MCP Memory Server.
 * 
 * Provides a structured interface to create entities, observations, and relations
 * in the dynamic memory graph.
 */

import { callMcpTool } from './mcp-connection-manager';

export interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export class MemoryClient {
  private serverName = 'memory';

  /**
   * Create new entities in the memory graph.
   * 中文：在记忆图谱中创建新实体。
   */
  async createEntities(entities: Entity[]) {
    return await this.call('create_entities', { entities });
  }

  /**
   * Add observations to existing entities.
   * 中文：向现有实体添加观察结果（记忆点）。
   */
  async addObservations(observations: { entityName: string; contents: string[] }[]) {
    return await this.call('add_observations', { observations });
  }

  /**
   * Create relations between entities.
   * 中文：在实体之间创建关系。
   */
  async addRelations(relations: Relation[]) {
    return await this.call('add_relations', { relations });
  }

  /**
   * Search for nodes matching a query.
   * 中文：搜索匹配查询条件的节点。
   */
  async searchNodes(query: string) {
    return await this.call('search_nodes', { query });
  }

  /**
   * Read the entire graph.
   * 中文：读取整个知识图谱。
   */
  async readGraph() {
    return await this.call('read_graph', {});
  }

  /**
   * Open specific nodes by name.
   * 中文：打开特定名称的节点及其关联。
   */
  async openNodes(names: string[]) {
    return await this.call('open_nodes', { names });
  }

  private async call(toolName: string, args: Record<string, unknown>) {
    try {
      return await callMcpTool(this.serverName, toolName, args);
    } catch (err) {
      console.error(`[MemoryClient] Failed to call ${toolName}:`, err);
      throw err;
    }
  }
}

export const memoryClient = new MemoryClient();
