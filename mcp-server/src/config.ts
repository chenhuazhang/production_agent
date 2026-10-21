import "dotenv/config";

/**
 * 配置项（统一从环境变量读取，便于容器 / 企微部署）
 *
 * AGENT_API_BASE   production_agent 智能问答地址，默认 http://localhost:8000
 *                  生产环境填写内网/公网可达地址，例如 http://10.0.0.12:8000
 * AGENT_API_TIMEOUT 单次问答最长等待毫秒数，默认 120000（2 分钟）
 * MCP_API_KEY      Service token / API key，企微插件「授权方式」处填写同样的 key
 *                  - 企微把 key 通过 Parameter name=api_key 以 query 参数形式传过来
 *                  - 未配置则不校验（仅建议内网调试时关闭）
 * MCP_PORT         MCP SSE 服务监听端口，默认 3000
 * USERID_HEADER   企微发送提问者 userid 的请求头名，默认 x-wecom-userid
 *                 企微提示「仅配置企业域名URL时，请求头将返回提问者userid」，
 *                 因此我们同时兼容以下常见头：x-wecom-userid / x-wechat-userid / userid
 */

export const config = {
  agentApiBase: process.env.AGENT_API_BASE?.replace(/\/+$/, "") || "http://localhost:8000",
  agentApiTimeoutMs: Number(process.env.AGENT_API_TIMEOUT_MS) || 120_000,
  mcpApiKey: process.env.MCP_API_KEY || "",
  mcpPort: Number(process.env.MCP_PORT) || 3000,
  useridHeader: process.env.USERID_HEADER || "x-wecom-userid",
};

/** 从请求中提取提问者 userid（企微请求头注入） */
export function extractUserid(headers: Record<string, string | undefined>): string {
  const candidates = [
    config.useridHeader,
    "x-wechat-userid",
    "x-wecom-userid",
    "userid",
  ];
  for (const key of candidates) {
    const v = headers[key.toLowerCase()];
    if (v) return v;
  }
  return "anonymous";
}
