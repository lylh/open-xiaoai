import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { MCPClient } from "./mcp-client.js";

export interface MCPToolResult {
  success: boolean;
  content: string;
  error?: string;
  toolName: string;
  executionTime: number;
}

export class MCPToolManager {
  private mcpClient: MCPClient;
  private toolCache: Map<string, Tool> = new Map();
  private lastUpdate = 0;
  private cacheTimeout = 5 * 60 * 1000; // 5分钟缓存

  constructor(mcpClient: MCPClient) {
    this.mcpClient = mcpClient;
  }

  async initialize(): Promise<void> {
    await this.refreshTools();
  }

  async refreshTools(): Promise<void> {
    try {
      const tools = await this.mcpClient.listAllTools();
      this.toolCache.clear();
      
      for (const tool of tools) {
        this.toolCache.set(tool.name, tool);
      }
      
      this.lastUpdate = Date.now();
      console.log(`📦 工具缓存已更新，共 ${tools.length} 个工具`);
    } catch (error) {
      console.error("刷新 MCP 工具列表失败:", error);
    }
  }

  shouldRefresh(): boolean {
    return Date.now() - this.lastUpdate > this.cacheTimeout;
  }

  async getAvailableTools(): Promise<Tool[]> {
    if (this.shouldRefresh()) {
      await this.refreshTools();
    }
    
    return Array.from(this.toolCache.values());
  }

  async findMatchingTools(query: string): Promise<Tool[]> {
    const tools = await this.getAvailableTools();
    const queryLower = query.toLowerCase();
    
    return tools.filter(tool => 
      tool.name.toLowerCase().includes(queryLower) ||
      tool.description?.toLowerCase().includes(queryLower) ||
      tool.inputSchema?.type?.toLowerCase().includes(queryLower)
    );
  }

  async executeTool(
    toolName: string, 
    arguments_: Record<string, unknown> = {}
  ): Promise<MCPToolResult> {
    const startTime = Date.now();
    
    try {
      // 检查是否需要刷新工具列表
      if (this.shouldRefresh()) {
        await this.refreshTools();
      }

      // 执行工具调用
      const result = await this.mcpClient.callTool(toolName, arguments_);
      const executionTime = Date.now() - startTime;

      // 处理结果内容
      let content = "";
      let isError = result.isError || false;

      if (result.content && result.content.length > 0) {
        content = result.content
          .map(item => {
            if (item.type === "text" && item.text) {
              return item.text;
            }
            return JSON.stringify(item, null, 2);
          })
          .join("\n");
      }

      if (isError) {
        content = `工具执行错误: ${content}`;
      }

      console.log(`🔧 工具执行完成: ${toolName} (${executionTime}ms)`);
      
      return {
        success: !isError,
        content: content || "工具执行完成，但未返回内容",
        error: isError ? content : undefined,
        toolName,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`工具执行失败: ${toolName}`, error);
      
      return {
        success: false,
        content: "",
        error: errorMessage,
        toolName,
        executionTime,
      };
    }
  }

  async smartExecute(query: string, context: string = ""): Promise<MCPToolResult | null> {
    // 尝试从查询中提取工具调用信息
    const toolMatch = this.extractToolCall(query);
    
    if (!toolMatch) {
      // 如果没有明确的工具调用，尝试智能匹配
      const matchingTools = await this.findMatchingTools(query);
      
      if (matchingTools.length === 0) {
        return null;
      }
      
      // 选择最匹配的工具（这里可以改进匹配算法）
      const selectedTool = matchingTools[0];
      return await this.executeTool(selectedTool.name);
    }

    const { toolName, arguments_ } = toolMatch;
    return await this.executeTool(toolName, arguments_);
  }

  private extractToolCall(query: string): { toolName: string; arguments_: Record<string, unknown> } | null {
    // 简单的工具调用解析（可以根据需要改进）
    // 支持格式如: "请调用天气查询工具查询北京天气"
    // 或者: "天气查询 北京"
    
    const patterns = [
      // 格式: "工具名 参数1 参数2"
      /^(\w+)\s+(.+)$/,
      // 格式: "请调用[工具名] [参数]"
      /请调用(\w+)(?:\s+(.+))?/,
      // 格式: "使用[工具名] [参数]"
      /使用(\w+)(?:\s+(.+))?/,
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        const [, toolName, argsString] = match;
        const arguments_ = this.parseArguments(argsString);
        return { toolName, arguments_ };
      }
    }

    return null;
  }

  private parseArguments(argsString?: string): Record<string, unknown> {
    if (!argsString) {
      return {};
    }

    // 简单的参数解析
    // 支持格式: "参数1 参数2 参数3" 或 "key1=value1 key2=value2"
    const arguments_: Record<string, unknown> = {};
    
    // 尝试键值对格式
    const kvPairs = argsString.split(/\s+/).filter(arg => arg.includes("="));
    
    if (kvPairs.length > 0) {
      for (const pair of kvPairs) {
        const [key, ...valueParts] = pair.split("=");
        arguments_[key] = valueParts.join("=");
      }
    } else {
      // 尝试位置参数
      const args = argsString.split(/\s+/);
      arguments_["args"] = args;
    }

    return arguments_;
  }

  getToolDescription(toolName: string): string | undefined {
    const tool = this.toolCache.get(toolName);
    return tool?.description;
  }

  getStats(): {
    totalTools: number;
    lastUpdate: number;
    cacheAge: number;
  } {
    const now = Date.now();
    return {
      totalTools: this.toolCache.size,
      lastUpdate: this.lastUpdate,
      cacheAge: this.lastUpdate > 0 ? now - this.lastUpdate : 0,
    };
  }
}