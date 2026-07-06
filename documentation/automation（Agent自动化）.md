# Agent 自动化：中试 AI 助手

## Agent 定义

每个聊天会话创建一个 `AgentSession`，配置如下：

- **模型**: 通过 `AI_PROVIDER` + `AI_MODEL` 环境变量配置
- **系统提示词**: AGENTS.md（角色、能力边界、意图路由、行为准则）+ 3 SKILL.md（order-progress / capacity-analysis / output-format）
- **思考级别**: `"low"`（reasoning tokens 作为 `thinking_delta` SSE 事件转发）
- **上下文压缩**: 默认启用（SettingsManager），长对话自动压缩

## 工具面（Agent 能做什么）

### 工具执行模型

每个工具用 `defineTool()` 定义 → TypeBox schema 约束参数 → `execute()` 执行函数。

```
用户消息 → LLM 决定调用哪些工具 → Agent 执行工具
  → 工具结果返回给 LLM → LLM 格式化回复 → SSE 流推给用户
```

### 工具清单

| # | 工具 | 类型 | 数据源 | 副作用 | 降级策略 |
|---|------|------|-------------|--------------|----------|
| 1 | `query_order_progress` | 读 | SQL Server（4 套模板，并行） | 无 | Mock 数据 |
| 2 | `search_orders` | 读 | Mock 数组 | 无 | N/A（仅 mock） |
| 3 | `get_production_stages` | 读 | 硬编码常量 | 无 | N/A（静态数据） |
| 4 | `analyze_capacity` | 读 | SQL（待处理数）+ Mock（设备参数） | 无 | 全量 mock |
| 5 | `recommend_base` | 读 | Mock 设备参数 + Mock 待处理数 | 无 | N/A（仅 mock） |
| 6 | `estimate_delivery` | 计算 | Mock 设备参数 + Mock 待处理数 | 无 | N/A（仅 mock） |

### 硬护栏（LLM 无法绕过）

1. **工具白名单**: Agent 不能调用 `TOOL_NAMES` 之外的任何工具 — 无 read/write/edit/bash/network 工具
2. **写操作拦截**: `permissionGuard.ts` 的 `DENY_ALWAYS` 前缀检查拦截所有以 `update_/delete_/write_/modify_/execute_sql/run_command` 开头的工具
3. **权限检查**: 每个工具的 execute() 开头调用 `checkPermission(toolName, params)` — ALS 用户上下文 + 角色矩阵
4. **SQL 参数化**: 所有查询使用 `@param` 绑定，无字符串拼接
5. **思考级别**: 固定为 `"low"` — LLM 无法自行增加推理预算

### 软护栏（LLM 通过遵循 prompt 来实现）

1. AGENTS.md 中的行为规则（意图路由、超出范围拒绝）
2. SKILL.md 中的格式化规则（表格格式、emoji 使用、时间格式）
3. 降级标注：使用 mock 数据时标注"当前基于模拟数据"

## 输出协议

### SSE 事件类型

| 事件 | 载荷 | 触发时机 |
|-------|---------|------|
| `text_delta` | `{ delta: string }` | LLM 输出的每个文本 token |
| `thinking_delta` | `{ delta: string }` | 每个推理 token（前端可折叠展示） |
| `tool_start` | `{ toolName, args }` | 工具执行前 |
| `tool_end` | `{ toolName, isError, result }` | 工具执行后 |
| `done` | `{}` | Agent 本轮结束 |
| `error` | `{ message }` | Agent 或工具异常 |

### 结构化 vs 自由文本

- **工具返回数据** → LLM 按 SKILL.md 规则格式化（表格、emoji、卡片式）
- **LLM 自由文本** → 无约束生成；可能产生幻觉
- **缓解**: 前端应视觉区分工具返回数据（卡片/表格标注"系统数据"）和 LLM 生成文本（"AI 分析"标注）

## Agent 会话生命周期

```
createSession() → AgentSession 创建
  ├── 会话 JSONL 文件打开于 ~/.pi/agent/sessions/{id}.jsonl
  ├── SessionStore 条目添加（内存，30min TTL）
  │
  ├── prompt("用户文本") → LLM 推理 → 工具调用 → 回复
  │   ├── 通过 subscribe() 回调流式推送事件
  │   ├── ExecutionTracer 记录每条 trace
  │   └── SessionManager 追加到 JSONL
  │
  ├── 后续 prompt 复用同一会话（保留对话上下文）
  │
  └── dispose() 在 TTL 到期或手动删除时触发
      ├── unsubscribe() 取消事件订阅
      └── JSONL 文件保留在磁盘（历史记录）
```

## 已知自动化缺口

| 缺口 | 影响 | 计划 |
|-----|--------|------|
| 无多轮工具调用链限制 | LLM 单轮可发起 10+ 次工具调用（成本 + 延迟） | 添加 max_tool_calls_per_turn 限制 |
| 无 per-session LLM 成本追踪 | 无法按用户/部门归因 API 费用 | 集成 pi-ai 的 token 计数 |
| 工具间 mock/real 数据不一致 | `analyze_capacity` 用 SQL，`recommend_base` 用 mock → 答案矛盾 | 所有工具统一数据源 |
| 无决策审批关卡 | LLM 可直接推荐基地，无人工确认环节 | 考虑为推荐类输出增加确认步骤 |
