# Open API：对外开放接口（供其他系统调用）

供外部系统程序化调用的只读 HTTP JSON 接口。当前开放两个端点：**查订单进度**（`GET /open/orders/progress`，按单号点查）与**订单列表查询**（`GET /open/orders/list`，多维过滤 + 近 3 个月窗口），均直连 SQL Server 数据层（`pi_agent/agent/services/sqlServer.ts`），不经过 LLM / Agent 工具层。

- 路由实现：`server/src/routes/open_api.ts`
- 鉴权中间件：`server/src/index.ts`（`/open/*` 前缀）
- **调用方对接文档（字段含义、入参、示例代码）**：[open-api-integration（开放接口对接指南）.md](open-api-integration（开放接口对接指南）.md)

## 为什么不走工具层 / LLM

| 考量 | 说明 |
|---|---|
| 无 mock 污染 | `query_order_progress` 工具在 SQL 失败时会降级返回内存 mock 数据——对外接口绝不允许返回假数据，因此直连数据层，SQL 失败就明确报错 |
| 结构化输出 | 外部系统需要机器可解析的 JSON，不需要 LLM 的自然语言总结 |
| 确定性 | 无 LLM 推理延迟与 token 成本，查询耗时 = SQL 耗时（通常秒级） |

**关于 CLAUDE.md 边界 #4（ALS 用户上下文）的显式例外**：数据层函数不读取 AsyncLocalStorage 用户上下文，系统级调用方的身份由 `OPEN_API_KEY` 承载（Bearer 鉴权 + JSONL 审计日志），而非 `runWithUser()`。此例外仅适用于本开放接口，Agent 工具执行路径不受影响。

## 端点

### `GET /open/orders/progress` — 查询订单生产进度

**鉴权**：请求头 `Authorization: Bearer <OPEN_API_KEY>`。

**Query 参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `order_no` | 是 | 订单编号（最长 64 字符） |
| `base` | 否 | 业务范围正式名或别名，见下方别名表。支持 `base=a&base=b` 与逗号分隔 `base=a,b`。不传 = 并行查询全部 5 个业务范围 |

**业务范围别名表**（正式名 + 别名，大小写不敏感）：

| 输入 | 解析为 |
|---|---|
| `广州工艺实验` | 广州工艺实验 |
| `广州送样&小订单` / `送样` / `小订单` | 广州送样&小订单 |
| `小试` / `研发实验` | 小试 |
| `上海工艺实验` | 上海工艺实验 |
| `工艺实验` | 广州工艺实验 + 上海工艺实验（展开为两个） |
| `OA辅助单` / `注塑单` / `研发辅助单` | OA辅助单 |

### 响应格式

统一信封 `{ ok: boolean, ... }`，错误对象带机器可读 `code`。

**200 命中**（`rows` 内日期为 `"YYYY-MM-DD HH:mm"` 北京时间字符串）：

```json
{
  "ok": true,
  "order_no": "EX2508001",
  "bases_queried": ["广州工艺实验", "上海工艺实验"],
  "matches": [
    {
      "base": "广州工艺实验",
      "order_no": "EX2508001",
      "rows": [
        {
          "order_no": "EX2508001",
          "牌号": "PA6-GF30",
          "machine": "T-01",
          "技术员": "张三",
          "create_order_time": "2026-08-01 09:30",
          "scheduling_time": "2026-08-02 14:00",
          "final_complete_time": null,
          "scheduling_exception": null
        }
      ],
      "found": true
    }
  ],
  "match_count": 1,
  "warnings": [{ "base": "上海工艺实验", "error": "..." }]
}
```

- `match_count > 1` 时附 `note`：同一订单号在多个业务范围命中
- 部分业务类型 SQL 失败但有命中时，失败项进 `warnings`（数据可用但覆盖不全）

**404 未找到**（部分类型 SQL 失败导致时附 `db_errors`，诚实表达"没找到可能是没查成"）：

```json
{
  "ok": false,
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "5 个业务范围均未找到订单 EX9999999",
    "hint": "请确认订单号是否正确。可查询的业务范围: ..."
  },
  "order_no": "EX9999999",
  "bases_queried": ["广州工艺实验", "广州送样&小订单", "小试", "上海工艺实验", "OA辅助单"],
  "db_errors": [{ "base": "上海工艺实验", "error": "..." }]
}
```

**错误码汇总**：

| HTTP | code | 场景 |
|---|---|---|
| 400 | `MISSING_PARAM` | 缺 `order_no` |
| 400 | `INVALID_PARAM` | `order_no` 超长 / `base` 无法识别（message 附可用关键词清单） |
| 401 | `UNAUTHORIZED` | 无 key 或 key 错误 |
| 403 | `FORBIDDEN` | 该 API Key 无权查询所请求的业务范围 |
| 404 | `ORDER_NOT_FOUND` | 所有业务范围查无此单 |
| 500 | `DB_ERROR` | 所查业务范围全部 SQL 失败（附 `details`） |
| 503 | `SERVICE_UNAVAILABLE` | `OPEN_API_KEY` 未配置（fail-closed，接口整体禁用） |

### curl 示例

```bash
# 不指定业务范围：并行查全部 5 类，返回命中的
curl -H "Authorization: Bearer $OPEN_API_KEY" \
  "http://<agent-host>:8001/open/orders/progress?order_no=EX2508001"

# 指定别名：工艺实验 → 广州工艺实验 + 上海工艺实验
curl -H "Authorization: Bearer $OPEN_API_KEY" \
  "http://<agent-host>:8001/open/orders/progress?order_no=EX2508001&base=%E5%B7%A5%E8%89%BA%E5%AE%9E%E9%AA%8C"
```

> 端口说明：本地 dev 为 8001，Docker 生产堆栈为 8000。

### `GET /open/orders/list` — 订单列表查询

多维过滤（`business_types` / `technician` / `base` / `grade` / `product_line` / `since` / `until` / `limit`），复用数据层 `queryOrdersList()`，3 个月窗口在 SQL 层强制。无 offset 分页，超量时调用方按 `truncated` 标记用时间段分段拉取。参数规格、响应字段与示例见对接指南第 7 节。

## 鉴权与审计

- **独立 key**：`OPEN_API_KEY` 与 MaxKB 的 `SYNC_API_KEY` 相互隔离（不同信任域，任一泄露不影响另一个）。变量登记见 [variables（环境变量）.md](variables（环境变量）.md)。
- **fail-closed**：`OPEN_API_KEY` 未配置时 `/open/*` 全部返回 503。这与 `/v1/*` 的 fail-open 策略相反——对外接口未鉴权暴露 = 订单生产数据外泄，配置遗漏必须立即显性暴露。
- **审计日志**：每次调用（含 401 鉴权失败）落盘 `data/logs/open-api-requests.jsonl`，字段 `{ ts, event: "query"|"list"|"auth_fail", order_no?, types?, filters?, status, total?/match_count?, duration_ms, ip? }`。不记录完整 rows 与完整 key。

## 边界声明（CLAUDE.md 关键边界合规）

| 边界 | 合规情况 |
|---|---|
| 只读系统 | ✅ 复用现有 5 套纯 SELECT 模板，零新 SQL、零写操作 |
| 工具白名单 | ✅ 不经 LLM / 工具层，直接调用数据层函数 |
| SQL 参数化 | ✅ `@orderNo` 绑定（`sql.NVarChar`），无字符串拼接 |
| ALS 用户上下文 | ⚠️ 显式例外（见文首说明） |
| 权限矩阵 | ✅ 不触碰 `TOOL_PERMISSIONS` |
| 环境变量 | ✅ 占位值进 `.env.example`，真实值仅存 gitignored 的 `pi_agent/.env` |

## 数据注意事项（调用方须知）

- **数据窗口（2026-08 起）**：所有查询仅返回最近 3 个月内有工序活动的订单（服务端 `DATEADD(MONTH, -3, GETDATE())` 硬限制，按各业务类型的高填充率时间列 OR 判定）。超过窗口返回 404，属预期行为。此限制同样作用于聊天工具与 Web 看板（全系统统一口径）。
- **工序人员字段**：广州工艺实验 / 广州送样&小订单 / 上海工艺实验的工序人员名在 SQL 模板中为硬编码常量（历史实现），并非实时查询结果；技术员、时间、异常字段为真实数据。小试 / OA辅助单的人员来自真实工序透视表。
- **上海多料次**：上海工艺实验一单多料次，`order_count` 为料次号，可能返回多行；整单完成以最后料次为准。
- **时间字段**：一律为北京时间墙钟字符串；未执行/未记录统一归一为 `null`（2026-08 起，历史库的 `"1900-01-01 00:00"`、空串哨兵在数据层归一，不再漏出）。实现：`formatSqlDatetime` 对 1900/1899/空串返回 null，`normalizeRowDates` 对时间字段连字符串一并归一（VARCHAR 列存的是文本哨兵）。
- **节点与状态（2026-08 起）**：点查 `rows[]` 每行新增 `status`（`已完成`/`生产中`）、`current_stage`、`current_stage_person`、`stages[]`（`{node, person, time, done}`），由数据层 `decorateProgressRow` 按业务规则算好。**对接方直接展示，禁止自行按工序时间推断当前节点**——色粉计量时间列记录率极低（近 3 个月 ~3.6%），推断会把未记录中间工序的单（含已完成单）误判为停在色粉称量（已实测 922 单验证）。「最后已完成工序的下一步」规则与整单完成信号（小试=注塑完成时间，其余=最终班长，OA=注塑）见 `sqlServer.ts` 的 `COMPLETE_KEY`/`STAGE_SPECS`。
