# production-agent 仓库说明

本仓库是一个 TypeScript monorepo：`pi_agent`（Agent 核心）+ `server`（Hono SSE）+ `web`（Next.js）。

> 运行期的产品人格不在这里。它由服务端显式加载 `pi_agent/agent/prompts/persona.md`，
> 与 SKILL.md 一起注入模型系统提示。改产品话术请改那个文件。

## 动手前先读

1. [CODING_STANDARDS.md](CODING_STANDARDS.md) — 编码规范、分层、提交前检查、已知偏差
2. [CLAUDE.md](CLAUDE.md) — 系统结构、六条硬边界、当前已知问题
3. [需求规格](Doc/production-agent/cn/01-需求规格.md) — 功能与业务规则

## 硬边界

- 生产数据只读：不新增写工具，不放宽 `DENY_ALWAYS`
- 所有 SQL 参数化，用户输入不进 SQL 字符串
- LLM 只能调用 `TOOL_NAMES` 里的领域工具，无 filesystem / shell / network
- `.env` 不入库、不进镜像

## 常用命令

```bash
npm test --workspace=pi_agent
npx tsc -p pi_agent/agent --noEmit
npx tsc -p server --noEmit
npm run lint --workspace=web
npm run dev --workspace=server   # :8001
npm run dev --workspace=web      # :3001
```
