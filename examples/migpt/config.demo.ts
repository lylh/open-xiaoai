import { sleep } from "@mi-gpt/utils";
import { OpenXiaoAIConfig } from "./migpt/xiaoai.js";

export const kOpenXiaoAIDemoConfig: OpenXiaoAIConfig = {
  openai: {
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-your-api-key-here",
    model: "gpt-4.1-mini",
  },
  prompt: {
    system: "你是一个智能助手，可以帮助用户调用各种工具。请简洁明了地回答问题。",
  },
  context: {
    historyMaxLength: 10,
  },
  callAIKeywords: ["请", "你"],
  async onMessage(engine, { text }) {
    if (text === "测试播放文字") {
      return { text: "你好，这是MCP集成的测试！" };
    }

    if (text === "测试播放音乐") {
      return { url: "https://example.com/hello.mp3" };
    }

    if (text === "测试MCP功能") {
      await engine.speaker.abortXiaoAI();
      await sleep(2000);
      await engine.speaker.play({ 
        text: "MCP功能已启用，你可以使用语音调用各种工具！", 
        blocking: true 
      });
      return { handled: true };
    }
  },
  /**
   * MCP 配置示例
   * 
   * 这个配置展示了如何启用和使用MCP功能
   */
  mcp: {
    enabled: true, // 启用MCP功能
    
    /**
     * 配置多个MCP服务器
     * 可以同时连接多个不同的MCP服务器
     */
    servers: [
      {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        env: {}
      },
      // 可以添加更多服务器：
      // {
      //   command: "node", 
      //   args: ["your-custom-server.js"],
      //   env: { API_KEY: "your-key" }
      // }
    ],
    
    /**
     * 启用自动工具调用
     * 当检测到关键词时会自动尝试调用MCP工具
     */
    enableAutoToolCall: true,
    
    /**
     * 触发MCP工具调用的关键词
     * 可以根据实际需求添加更多关键词
     */
    toolCallKeywords: [
      "调用", "查询", "搜索", "获取", "文件", "读取", 
      "列出", "显示", "打开", "查看", "搜索文件"
    ],
    
    /**
     * 工具调用超时时间（毫秒）
     * 避免长时间阻塞语音响应
     */
    timeout: 30000,
  },
};

/**
 * 使用说明：
 * 
 * 1. 复制此文件为 config.ts:
 *    cp config.demo.ts config.ts
 * 
 * 2. 修改API密钥:
 *    将 "sk-your-api-key-here" 替换为你的真实API密钥
 * 
 * 3. 安装MCP服务器依赖:
 *    npm install -g @modelcontextprotocol/server-filesystem
 * 
 * 4. 启动服务:
 *    npm run dev
 * 
 * 5. 使用语音指令测试:
 *    - "请帮我读取config.ts文件"
 *    - "调用搜索功能"
 *    - "查询当前目录的文件"
 *    - "获取文件列表"
 */