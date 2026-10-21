/**
 * Production Agent MCP Server (SSE)
 *
 * 作用：作为企微智能机器人插件的 MCP 后端。
 *   企微机器人 → 本服务（MCP SSE，端口 MCP_PORT，默认 3000）→ production_agent 智能问答（端口 8000）
 *
 * 传输协议：SSE（标准 MCP SSEServerTransport，需要 /sse 与 /messages 两个端点）
 * 授权方式：Service token / API key（企微以 Parameter name=api_key 的 query 参数传入，本服务校验）
 * 提问者  ：企微在请求头中注入 userid（见 config.ts USERID_HEADER）
 */
import "dotenv/config";

import express, { type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { config, extractUserid } from "./config.js";
import { askAgent } from "./agentClient.js";

const app = express();
app.use(express.json());

// 每个 SSE 连接 → 独立的 transport 与 server 实例
const transports: Record<string, SSEServerTransport> = {};

/** 鉴权中间件：校验 api_key（与企微插件配置的 Service token 一致） */
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.mcpApiKey) {
    // 未配置 key 时放行（仅建议内网调试）
    return next();
  }
  const key = req.query.api_key ?? req.headers["x-api-key"];
  if (key !== config.mcpApiKey) {
    res.status(401).json({ error: "unauthorized: invalid api_key" });
    return;
  }
  next();
}

/** 构造一个绑定当前连接的 McpServer（工具实现里能读到企微 userid） */
function buildServer(userid: string): McpServer {
  const server = new McpServer({
    name: "production-agent-mcp",
    version: "1.0.0",
  });

  // 工具：订单 / 生产进度智能问答
  server.tool(
    "query_production_order",
    "查询中试生产订单的进度与状态。可询问指定订单编号在某生产基地的生产进度、" +
      "负责人、各工序时间、异常信息，或让 AI 自动定位订单归属基地。" +
      "支持的基地范围：中试广州 / 小试 / 中试上海 / OA辅助单。",
    {
      question: z
        .string()
        .describe("自然语言问题，例如「ZS-2026-001 在中试广州的生产进度到哪了？」或「帮我查一下订单 2026-008 的状态」"),
      session_id: z
        .string()
        .optional()
        .describe("可选：会话 id，用于多轮上下文记忆；不传则使用一次性会话"),
    },
    async ({ question, session_id }: { question: string; session_id?: string }) => {
      const result = await askAgent({ question, userid, sessionId: session_id });
      if (result.error && !result.answer) {
        return {
          content: [{ type: "text" as const, text: `调用生产 Agent 失败：${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: result.answer }],
      };
    },
  );

  // 工具：产能 / 交期 / 下单推荐类通用问答
  server.tool(
    "ask_production_agent",
    "通用生产域问答。可用于产能负荷分析、交期估算、智能下单基地推荐、" +
      "多基地产能对比等生产调度相关问题。",
    {
      question: z.string().describe("生产域相关问题，例如「成都基地下单 20 吨要几天？」或「对比五个基地的产能负荷」"),
      session_id: z.string().optional().describe("可选：会话 id，用于多轮上下文记忆"),
    },
    async ({ question, session_id }: { question: string; session_id?: string }) => {
      const result = await askAgent({ question, userid, sessionId: session_id });
      if (result.error && !result.answer) {
        return {
          content: [{ type: "text" as const, text: `调用生产 Agent 失败：${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: result.answer }],
      };
    },
  );

  return server;
}

// ---- MCP SSE 端点（企微插件 URL 填这个） ----
app.get("/sse", authMiddleware, async (req: Request, res: Response) => {
  const userid = extractUserid(req.headers as Record<string, string | undefined>);
  const server = buildServer(userid);

  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

// ---- MCP 消息端点 ----
// 注意：标准 MCP SSE 协议里，/sse 连接时返回的 endpoint 事件只带 sessionId、
// 不带 api_key，客户端随后的 POST /messages 不会携带 api_key。
// 因此鉴权只在 /sse 这道「建连」关卡做；/messages 仅凭已通过鉴权时创建的
// sessionId（随机 UUID，不可猜测）来识别会话，不再二次校验 api_key。
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId || "");
  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).json({ error: "unknown sessionId" });
    return;
  }
  // 已用 express.json() 解析过 body，直接把解析结果交给 SDK，
  // 避免 SDK 再读已被消费的流导致挂起。
  await transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "production-agent-mcp", agentApiBase: config.agentApiBase });
});

app.listen(config.mcpPort, () => {
  console.log(`🚀 Production Agent MCP (SSE) 已启动: http://localhost:${config.mcpPort}`);
  console.log(`   SSE 端点:   GET  http://localhost:${config.mcpPort}/sse`);
  console.log(`   消息端点:   POST http://localhost:${config.mcpPort}/messages`);
  console.log(`   后端 Agent: ${config.agentApiBase}`);
  console.log(`   鉴权:       ${config.mcpApiKey ? "已启用 (api_key)" : "未启用（调试模式）"}`);
});
