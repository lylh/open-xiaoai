import { type EngineConfig, MiGPTEngine } from "@mi-gpt/engine";
import { deepMerge } from "@mi-gpt/utils";
import { jsonDecode } from "@mi-gpt/utils/parse";
import type { Prettify } from "@mi-gpt/utils/typing";
import { RustServer } from "./open-xiaoai.js";
import { OpenXiaoAISpeaker } from "./speaker.js";
import { randomUUID } from "node:crypto";
import { MCPClient } from "./mcp-client.js";
import { MCPToolManager } from "./mcp-tools.js";

export type OpenXiaoAIConfig = Prettify<EngineConfig<OpenXiaoAIEngine>>;

const kDefaultOpenXiaoAIConfig: OpenXiaoAIConfig = {
  //
};

class OpenXiaoAIEngine extends MiGPTEngine {
  speaker = OpenXiaoAISpeaker;
  mcpClient?: MCPClient;
  mcpToolManager?: MCPToolManager;

  async start(config: OpenXiaoAIConfig) {
    await super.start(deepMerge(kDefaultOpenXiaoAIConfig, config));
    // 注册全局回调函数
    (global as any).RUST_CALLBACKS = {
      on_event: this.onEvent,
      on_input_data: this.onRecord,
    };
    
    // 初始化MCP功能
    await this.initializeMCP(config);
    
    // 启动服务
    console.log("✅ 服务已启动...");
    await RustServer.start();
  }

  private async initializeMCP(config: OpenXiaoAIConfig): Promise<void> {
    const mcpConfig = config.mcp;
    
    if (!mcpConfig?.enabled || !mcpConfig.servers || mcpConfig.servers.length === 0) {
      console.log("ℹ️ MCP 功能未启用或未配置服务器");
      return;
    }

    try {
      console.log("🔌 正在初始化 MCP 客户端...");
      
      this.mcpClient = new MCPClient({
        servers: mcpConfig.servers,
        timeout: mcpConfig.timeout || 30000,
      });

      await this.mcpClient.initialize();

      this.mcpToolManager = new MCPToolManager(this.mcpClient);
      await this.mcpToolManager.initialize();

      const status = this.mcpClient.getStatus();
      console.log(`🎯 MCP 客户端初始化成功，连接了 ${status.servers} 个服务器，共 ${status.totalTools} 个工具`);
      
    } catch (error) {
      console.error("❌ MCP 客户端初始化失败:", error);
    }
  }

  /**
   * 收到事件
   */
  onEvent = (event: string) => {
    const e = JSON.parse(event);
    if (e.event === "playing") {
      // 更新播放状态
      OpenXiaoAISpeaker.status =
        e.data === "Playing"
          ? "playing"
          : e.data === "Paused"
          ? "paused"
          : "idle";
    } else if (e.event === "instruction" && e.data.NewLine) {
      // 收到语音识别结果
      const line = jsonDecode(e.data.NewLine);
      if (
        line?.header?.namespace === "SpeechRecognizer" &&
        line?.header?.name === "RecognizeResult" &&
        line?.payload?.is_final &&
        line?.payload?.results?.[0]?.text
      ) {
        const text = line.payload.results[0].text;
        // 使用异步方式处理消息，包含MCP功能
        this.handleUserMessage(text);
      }
    } else if (e.event === "kws") {
      const keyword = e.data;
      console.log("🔥 唤醒词识别", keyword);
    }
  };

  /**
   * 处理用户消息，包含MCP功能
   */
  private async handleUserMessage(text: string): Promise<void> {
    try {
      // 首先检查是否启用了MCP并且有MCP工具管理器
      if (this.mcpConfig?.enabled && this.mcpToolManager && this.mcpConfig?.enableAutoToolCall) {
        // 检查消息是否包含MCP工具调用关键词
        const keywords = this.mcpConfig.toolCallKeywords || ["调用", "查询", "搜索", "获取"];
        const hasMCPKeyword = keywords.some(keyword => text.includes(keyword));
        
        if (hasMCPKeyword) {
          console.log(`🔧 检测到MCP工具调用关键词，尝试执行: ${text}`);
          
          // 尝试执行MCP工具
          const toolResult = await this.mcpToolManager.smartExecute(text);
          
          if (toolResult && toolResult.success) {
            console.log(`✅ MCP工具执行成功: ${toolResult.toolName}`);
            
            // 将MCP结果转换为语音播放
            if (this.speaker) {
              await this.speaker.play({ 
                text: `工具执行结果: ${toolResult.content}`,
                blocking: true 
              });
            }
            
            // 标记消息已处理，不进行默认的AI回复
            return;
          } else if (toolResult) {
            console.log(`❌ MCP工具执行失败: ${toolResult.error}`);
            if (this.speaker) {
              await this.speaker.play({ 
                text: `抱歉，工具执行失败: ${toolResult.error}`,
                blocking: true 
              });
            }
            return;
          }
        }
      }
      
      // 如果没有使用MCP工具或MCP未启用，则使用默认的AI回复流程
      this.onMessage({
        text,
        id: randomUUID(),
        sender: "user",
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("处理用户消息时出错:", error);
      // 出错时使用默认AI回复
      this.onMessage({
        text,
        id: randomUUID(),
        sender: "user",
        timestamp: Date.now(),
      });
    }
  }

  private get mcpConfig() {
    return (this.config as OpenXiaoAIConfig)?.mcp;
  }

  /**
   * 收到录音音频流
   */
  onRecord = (data: Uint8Array) => {
    console.log("🔥 收到录音音频流", data.length);
  };

  /**
   * 停止服务时清理MCP资源
   */
  async stop() {
    try {
      // 关闭MCP连接
      if (this.mcpClient) {
        console.log("🔌 正在关闭 MCP 客户端...");
        await this.mcpClient.close();
        this.mcpClient = undefined;
        this.mcpToolManager = undefined;
        console.log("✅ MCP 客户端已关闭");
      }
      
      // 调用父类的停止方法
      await super.stop();
    } catch (error) {
      console.error("停止服务时出错:", error);
      throw error;
    }
  }
}

export const OpenXiaoAI = new OpenXiaoAIEngine();
