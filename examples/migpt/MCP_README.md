# MiGPT MCP 功能集成说明

## 功能概述

MiGPT 现在集成了 Model Context Protocol (MCP) 功能，可以通过语音指令调用外部MCP工具和服务器，极大扩展了语音助手的实用性。

## 主要特性

- 🔌 **多服务器支持**: 可同时连接多个MCP服务器
- 🔧 **智能工具调用**: 自动检测关键词并调用相关工具
- 🎯 **语音集成**: 与小爱语音助手无缝集成
- 🛡️ **错误处理**: 完善的错误处理和降级机制
- ⚡ **高性能**: 异步处理，不阻塞语音响应

## 使用方法

### 1. 安装依赖

确保已安装项目依赖：

```bash
cd examples/migpt
npm install
```

### 2. 配置MCP服务器

编辑 `config.ts` 文件，修改MCP配置：

```typescript
mcp: {
  enabled: true, // 启用MCP功能
  servers: [
    {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: {}
    },
    {
      command: "node",
      args: ["your-custom-mcp-server.js"],
      env: { API_KEY: "your-api-key" }
    }
  ],
  enableAutoToolCall: true,
  toolCallKeywords: ["调用", "查询", "搜索", "获取", "文件", "读取"],
  timeout: 30000,
}
```

### 3. 启动服务

```bash
npm run dev
```

### 4. 语音指令示例

当MCP功能启用后，你可以使用以下语音指令：

- "请帮我查询今天的天气"
- "调用搜索功能找一下相关信息"
- "读取config.ts文件内容"
- "获取文件列表"

## 支持的MCP服务器

### 文件系统服务器

```bash
npm install -g @modelcontextprotocol/server-filesystem
```

### 其他常用服务器

- `@modelcontextprotocol/server-brave-search` - Brave搜索
- `@modelcontextprotocol/server-postgres` - PostgreSQL数据库
- `@modelcontextprotocol/server-memory` - 内存数据库

## 配置选项说明

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | false | 是否启用MCP功能 |
| `servers` | array | [] | MCP服务器配置数组 |
| `enableAutoToolCall` | boolean | true | 是否启用自动工具调用 |
| `toolCallKeywords` | string[] | ["调用", "查询", "搜索", "获取"] | 触发MCP工具的关键词 |
| `timeout` | number | 30000 | 工具调用超时时间（毫秒） |

## 服务器配置结构

```typescript
{
  command: string;        // 可执行文件路径
  args: string[];         // 启动参数
  env?: Record<string, string>; // 环境变量（可选）
}
```

## 日志信息

启动时会显示MCP相关日志：

- 🔌 `正在初始化 MCP 客户端...`
- ✅ `MCP 客户端初始化成功，连接了 X 个服务器，共 Y 个工具`
- ℹ️ `MCP 功能未启用或未配置服务器`
- ❌ `MCP 客户端初始化失败: error`

## 错误处理

当MCP工具调用失败时：

1. 会记录详细错误日志
2. 自动降级到默认AI回复
3. 语音播放错误信息给用户

## 注意事项

1. 确保MCP服务器已正确安装和配置
2. 网络连接正常，MCP服务器可以访问
3. 关键词匹配区分中英文，建议根据实际需求调整
4. 工具调用有超时限制，避免长时间阻塞

## 故障排除

### 问题1: MCP客户端初始化失败

**解决方案**:
- 检查MCP服务器是否正确安装
- 验证命令路径和参数是否正确
- 查看详细错误日志

### 问题2: 语音指令无法触发MCP工具

**解决方案**:
- 确认`enabled: true`
- 检查关键词是否包含在`toolCallKeywords`中
- 验证消息是否包含关键词

### 问题3: 工具调用超时

**解决方案**:
- 增加`timeout`配置值
- 检查MCP服务器响应速度
- 优化工具调用逻辑

## 开发自定义MCP服务器

你可以开发自己的MCP服务器来扩展功能：

1. 安装MCP SDK: `npm install @modelcontextprotocol/sdk`
2. 参考官方文档创建服务器
3. 在配置中添加服务器信息
4. 使用合适的关键词触发工具调用

更多信息请参考: https://modelcontextprotocol.io/