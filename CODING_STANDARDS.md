# 编码规范（Coding Standards）

> 适用范围：本仓库全部 TypeScript 代码（`pi_agent/` · `server/` · `web/`）。
> 本文只回答**新代码该怎么写**。业务规则与产品边界见
> [需求规格](Doc/production-agent/cn/01-需求规格.md) 与 [CLAUDE.md](CLAUDE.md)，此处不重复。

## 0. 优先级

1. 本文条款 + `CLAUDE.md` 的六条边界（只读、工具白名单、参数化 SQL、ALS、权限矩阵、密钥）
2. 邻近代码的既有写法
3. 通用坏味道基线（重复代码、发散式变化、霰弹式修改等）

违反第 1 条是**硬性问题**；第 2、3 条是**判断题**。工具已经能查的（格式、lint）
不再重复报。

---

## 1. 语言与格式

| 项 | 规则 |
|---|---|
| 类型 | 三个 tsconfig 均 `strict: true`；新代码不得新增 `any`（`web` 由 eslint 拦截，其余靠 review） |
| 缩进 / 引号 | 2 空格；双引号；语句结尾分号 |
| 导出 | 具名 `export function` / `export const`；只有 Next 的 `page.tsx` / `layout.tsx` 用 `export default` |
| 类型导入 | 用 `import type { X } from ...`，与值导入分开 |
| 相对导入 | `pi_agent/agent` 带 `.js` 后缀（Node ESM）；`server/src` 不带后缀；`web` 用 `@/` 别名 |
| 文件名 | 新文件用 camelCase；React 组件 PascalCase；既有 snake_case 文件不强制改名 |

## 2. 分层与依赖方向

```
pi_agent:  tools.ts ──► services/* ──► (mssql)
                └────► data/*（纯函数 / mock）
server:    routes/* ──► services/*
web:       app/* ──► components/* ──► lib/*
```

- `tools.ts` 不写 SQL；SQL 只出现在 `services/sqlServer.ts`。
- `services/sqlServer.ts` 是纯数据层：不 import `defineTool`、不读 ALS、不产出给 LLM 的文案。
- 角色与范围判断只在 `services/permissionGuard.ts`；工具层调用它，不自己再写一遍。
- 页面组件不直接连库；数据访问放 `lib/` 或 `app/api/*`。
- 新增跨端数据需求优先走 server 的 `/open/*`，不要在 `web` 再复制一套 SQL 模板。

## 3. 领域语言

- 业务范围值保持中文原文：`"广州送样&小订单"`、`"小试"`。不要翻译成内部标识
  （`production-agent-gz` 这类模型名只存在于 `scopes.ts` 的映射里）。
- `BaseName` 是唯一的业务范围类型。新增一个范围要同步八处：类型与清单、别名表、
  窗口谓词、点查 SQL、`STAGE_SPECS`、`COMPLETE_KEY`、`ORDER_LIST_SPECS`、工具参数 schema。
- 点查结果的行字段是 **ERP 列别名**（`order_no`、`牌号`、`注塑完成时间`），
  `skills/order-progress/SKILL.md` 与外部对接方依赖这些键；不得改成 camelCase。
- `web` 的 `DashboardOrder` 是另一套投影（camelCase）。改字段要同步
  `web/src/lib/sqlServer.ts` 的 `parseRows` 与看板组件。

## 4. 数据层（`services/sqlServer.ts`）

- 用户输入一律 `request.input(name, type, value)` 绑定；SQL 字符串只允许拼接
  白名单常量（表名、列名、窗口谓词），任何用户值都不许进字符串。
- `LIKE` 写成 `N'%' + @param + N'%'`，不要拼进 SQL。
- 时间：库里存的是北京时间墙钟。对外返回 `YYYY-MM-DD HH:mm`，**禁止做时区换算**。
- 哨兵值（`1900-*` / `1899-*` / 空串）一律归一为 `null`；新增时间字段要登记进
  `TIME_FIELD_KEYS`。
- 3 个月数据窗口写在 SQL 里（服务端 `GETDATE()`），不依赖客户端时钟。
- 纯构建函数（`build*Query`、`decorate*`、`aggregate*`）不得读 env、不得建连接，
  保证可以脱离数据库单测。
- 数据层**抛错**；不要在这里降级 mock。降级与措辞属于工具层。

## 5. 工具层（`tools.ts`，LLM 的 interface）

- 工具名 snake_case；描述用中文，必须写清：支持的业务范围、3 个月窗口、
  查不到时的提示（审批未走完 / 单号错误）。
- `execute` 第一句必须 `checkPermission(...)`；拒绝时 `return textResult({ error })`。
- 所有返回都过 `textResult()`；返回体是给 LLM 读的 JSON，键名 snake_case。
- 业务失败用 `{ error, hint }` 表达，**不要 throw**——throw 会把框架错误直接暴露给模型。
- 不新增写工具；`permissionGuard` 的 `DENY_ALWAYS` 前缀不可放宽。

## 6. HTTP 契约

| 入口 | 成功 | 失败 |
|---|---|---|
| `POST /api/chat/:sessionId` | SSE：`text_delta` / `thinking_delta` / `tool_start` / `tool_end` / `done` | `{ error: string }` + 400/429/500 |
| `GET/POST /api/*`（Next） | 领域 JSON | `{ error: string }` + 状态码 |
| `/open/*` | `{ ok: true, ... }` | `{ ok: false, error: { code, message } }` |

- `/open/*` 的错误码是契约：`MISSING_PARAM` / `INVALID_PARAM` / `UNAUTHORIZED` /
  `ORDER_NOT_FOUND` / `DB_ERROR` / `SERVICE_UNAVAILABLE`。新增要同步
  `documentation/open-api（开放接口）.md`。
- SSE 事件名是前端契约；改名要同步 `web/src/lib/ai-client.ts` 与 `README.md`。
- 对外接口 fail-closed：缺 Key 返回 503，不静默放行。
- 不同信任域用不同 Key（`OPEN_API_KEY` 与 `SYNC_API_KEY` 不共用）。

## 7. 配置与密钥

- 环境变量在函数内读取（`getSqlConfig()`、`getEnvConfig()`），不在模块顶层读；
  模块顶层只允许连接池 / Prisma 客户端的单例。
- 密钥只从 env 来，不写进代码、日志、错误响应。
- 新增 Key 要同步 `documentation/variables（环境变量）.md` 与 `deploy/.env.production`。

## 8. 注释

- 每个文件顶部一段 JSDoc：这个模块是什么 + 为什么这样设计。
- 注释用中文，技术名词保留英文（SQL Server、SSE、LLM、Agent）。
- 反直觉的业务规则必须写「为什么」：时区、哨兵、3 个月窗口、上海料次聚合。
- 分节用 `// ── 标题 ──` 或 `// ====`；不写「给变量赋值」这类复述。

## 9. 测试

- 单测放 `pi_agent/agent/**/*.test.ts`，与实现同目录，用 vitest。
- 纯函数必须有测试：查询构建、时间归一、工序装饰、料次聚合、额度降级识别。
- 涉及数据库的测试用假 pool / 假 session，不连真实库。
- e2e 脚本放 `tests/e2e_*.mjs`，手动运行，不进 CI。
- 新增业务规则至少补一条单测；确实无法测的分支要在 PR 说明原因。

## 10. 提交前检查

```bash
npm test --workspace=pi_agent        # 48 tests
npx tsc -p pi_agent/agent --noEmit
npx tsc -p server --noEmit
npm run lint --workspace=web
```

基线（2026-10-22）：测试全绿、两个 tsc 全绿；`web` lint 仍有 9 error / 4 warning，
见下表。**新增代码不得新增 error**。

## 11. 已知偏差（不要重复上报）

| 位置 | 现状 | 处理 |
|---|---|---|
| `pi_agent/agent/index.ts` 等 5 个文件 | 相对导入缺 `.js` | 改到附近时顺手补；新文件一律带 |
| `web/src/lib/prisma.ts` | 无分号、模块顶层读 `DATABASE_URL` | 新代码不跟随 |
| `web` 9 个 lint error | `any`、`jsx-key`、effect 内 setState | 增量收紧，不新增 |
| `server/src/routes/sessions.ts` | 同步 `fs.*`、路由直接解析 JSONL | 见架构评审 06 |
| `web/src/lib/sqlServer.ts` | 与 `pi_agent` 重复的五套 SQL | 见架构评审 05 |

## 12. 变更级 spec

单次改动的验收标准放 `docs/specs/`，命名与模板见
[docs/specs/README.md](docs/specs/README.md)。整仓评审可直接以
[需求规格](Doc/production-agent/cn/01-需求规格.md) 作为 Spec。
