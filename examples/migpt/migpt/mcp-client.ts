import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// 支持两种类型的MCP服务器：stdio和HTTP
export interface MCPServerConfig {
  // 服务器名称（可选，如果不提供则使用索引）
  name?: string;
  // 服务器类型：stdio（默认）或http
  type?: 'stdio' | 'http';
  // stdio服务器配置
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // HTTP服务器配置
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPClientConfig {
  servers: MCPServerConfig[];
  timeout?: number;
}

export class MCPClient {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, Tool[]> = new Map();
  private config: MCPClientConfig;
  private initialized = false;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log("🔌 正在初始化 MCP 客户端...");
    
    for (let i = 0; i < this.config.servers.length; i++) {
      const serverConfig = this.config.servers[i];
      const serverName = serverConfig.name || `server-${i}`;
      
      try {
        const client = new Client(
          {
            name: "migpt-mcp-client",
            version: "1.0.0",
          },
          {
            capabilities: {
              tools: {},
            },
          }
        );

        let transport;
        const serverType = serverConfig.type || 'stdio';

        if (serverType === 'http') {
          // HTTP服务器连接
          if (!serverConfig.url) {
            throw new Error(`HTTP服务器配置缺少url参数: ${serverName}`);
          }

          console.log(`🌐 连接HTTP MCP服务器: ${serverName} (${serverConfig.url})`);
          
          transport = new StreamableHTTPClientTransport(
            new URL(serverConfig.url),
            {
              requestInit: {
                headers: serverConfig.headers || {},
              },
            }
          );
        } else {
          // stdio服务器连接（默认）
          if (!serverConfig.command || !serverConfig.args) {
            throw new Error(`stdio服务器配置缺少command或args参数: ${serverName}`);
          }

          console.log(`💻 启动stdio MCP服务器: ${serverName} (${serverConfig.command} ${serverConfig.args.join(' ')})`);
          
          const process = spawn(
            serverConfig.command,
            serverConfig.args,
            {
              stdio: ['pipe', 'pipe', 'inherit'],
              env: { ...process.env, ...serverConfig.env }
            }
          );

          transport = new StdioClientTransport({
            process,
          });
        }

        await client.connect(transport);
        this.clients.set(serverName, client);

        // 获取可用工具列表
        const toolsResult = await client.listTools();
        this.tools.set(serverName, toolsResult.tools || []);

        console.log(`✅ MCP 服务器连接成功: ${serverName}`);
        console.log(`📦 可用工具数量: ${toolsResult.tools?.length || 0}`);
        
      } catch (error) {
        console.error(`❌ MCP 服务器连接失败: ${serverName}`, error);
      }
    }

    this.initialized = true;
    console.log("🎯 MCP 客户端初始化完成");
  }

  async listAllTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];
    
    for (const [serverName, tools] of this.tools) {
      for (const tool of tools) {
        allTools.push({
          ...tool,
          name: `${serverName}:${tool.name}`,
        });
      }
    }
    
    return allTools;
  }

  async callTool(toolName: string, arguments_: Record<string, unknown> = {}): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  }> {
    // 解析工具名称（格式: server-name:tool-name）
    const [serverName, actualToolName] = toolName.split(":");
    
    if (!serverName || !actualToolName) {
      throw new Error(`无效的工具名称格式: ${toolName}，应为 server-name:tool-name`);
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP 客户端未找到: ${serverName}`);
    }

    try {
      const result = await client.callTool({
        name: actualToolName,
        arguments: arguments_,
      });

      return {
        content: result.content,
        isError: result.isError,
      };
    } catch (error) {
      console.error(`调用 MCP 工具失败: ${toolName}`, error);
      return {
        content: [
          {
            type: "text",
            text: `调用工具失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async close(): Promise<void> {
    console.log("🔌 正在关闭 MCP 客户端...");
    
    for (const [serverName, client] of this.clients) {
      try {
        await client.close();
        console.log(`✅ MCP 客户端已关闭: ${serverName}`);
      } catch (error) {
        console.error(`❌ 关闭 MCP 客户端失败: ${serverName}`, error);
      }
    }
    
    this.clients.clear();
    this.tools.clear();
    this.initialized = false;
  }

  getStatus(): {
    connected: boolean;
    servers: number;
    totalTools: number;
  } {
    return {
      connected: this.initialized,
      servers: this.clients.size,
      totalTools: Array.from(this.tools.values()).reduce((sum, tools) => sum + tools.length, 0),
    };
  }
}