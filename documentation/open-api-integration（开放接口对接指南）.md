# 【查询】订单生产进度接口文档

## 【前置使用条件】

调用本接口前，需确认：

1. 已获取中试系统管理员分配的 `OPEN_API_KEY`（见第 2 节，本文档已附）
2. 调用方网络可访问中试 Agent 服务器内网地址 `172.19.42.245:8001`（注意：**必须使用 8001 端口**；8000/80 为 Docker 堆栈内部端口，请勿直接调用）

## 【注意事项】

| 注意事项 | 说明 |
|---|---|
| 数据窗口 | **仅返回最近 3 个月内有工序活动的订单**（服务端硬限制）。超过 3 个月无任何工序活动的订单返回 404，即使该订单历史上存在 |
| base 为中文 | `base` 参数值为中文，URL 中需百分号编码（多数 HTTP 库自动处理，如 Python `requests` 的 `params=`、curl 的 `--data-urlencode`） |
| 时间格式 | 所有时间字段为北京时间 `"YYYY-MM-DD HH:mm"` 字符串，**无需做任何时区转换** |
| 空时间约定 | 未执行/未记录的工序时间统一返回 `null`（历史库里的 `"1900-01-01 00:00"`、空串等哨兵已归一为 `null`），`null` = 尚未执行，不需要再做任何哨兵判断 |
| 节点与状态 | 每个订单行已带 `status`（`已完成`/`生产中`）、`current_stage`（当前工序）、`stages[]`（各工序明细），**直接展示即可，不要自行按工序时间推断"当前节点"**——源 ERP 部分工序时间（如色粉计量）记录率极低，自行推断会把所有单误判为停在色粉称量 |
| 上海多料次 | 上海工艺实验一单可能返回多行（一行 = 一个料次，`order_count` = 料次号），整单状态以最后料次为准 |
| 人员字段 | 广州两类 / 上海工艺实验的部分工序人员为岗位固定值（历史实现）；技术员、时间、异常字段均为实时真实数据。只关心时间与异常的调用方可忽略此条 |
| 超时设置 | 不传 `base` 时服务端并行查 5 个业务范围，客户端超时建议 ≥ 30 秒（实测 1~2 秒返回） |
| 调用频率 | 请勿高频轮询（建议间隔 ≥ 30 秒）；批量场景并发 ≤ 2 路，避免挤占中试车间正常查询 |

## 1. 接口描述

| 项目 | 内容 |
|---|---|
| 接口名称 | 中试订单生产进度查询 |
| 接口功能 | 按订单号实时查询中试订单的生产进度（各工序人员、时间、异常信息），直连生产管理数据库，非缓存、非 AI 生成 |
| 接口地址 | `http://172.19.42.245:8001/open/orders/progress` |
| 请求方式 | GET |
| Content-Type | application/json（响应） |
| 字符编码 | UTF-8 |
| 认证方式 | Bearer Token |
| 数据性质 | 只读，本接口不会修改任何生产数据 |

## 2. 认证方式

| 项目 | 内容 |
|---|---|
| 认证类型 | Bearer Token |
| Header | `Authorization: Bearer {OPEN_API_KEY}` |
| OPEN_API_KEY | `sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473` |

> ⚠️ 此 Key 仅限对接方系统集成使用，请勿外传文档；Key 只出现在请求头中，不要写进前端页面或日志。如怀疑泄露请联系中试系统管理员轮换。

## 3. 参数

### 3.1 请求参数表（Query String）

| 层级 | 参数名 | 类型 | 必填 | 说明 | 默认值 |
|---|---|---|---|---|---|
| 1 | order_no | string | 是 | 订单编号，完整单号精确匹配（最长 64 字符），如 `EX20260804-1042` | - |
| 2 | base | string | 否 | 业务范围，支持正式名与别名（见 3.2）；支持 `base=a&base=b` 或逗号分隔 `base=a,b` 传多个 | 不传 = 并行查询全部 5 个业务范围（不确定归属时推荐不传） |

> 本接口**只支持按订单号点查**。按技术员 / 牌号 / 时间范围等维度的批量列表查询请使用 [7. 接口二：订单列表查询](#7-接口二订单列表查询get-openorderslist)。

### 3.2 base 取值表

| 传入值 | 类别 | 含义 |
|---|---|---|
| `广州工艺实验` | 正式名 | 广州基地工艺实验单，订单号含 EX |
| `广州送样&小订单` | 正式名 | 广州基地送样/小订单，订单号不含 EX |
| `小试` | 正式名 | 全集团小试单，订单号含 EX |
| `上海工艺实验` | 正式名 | 上海基地工艺实验单，订单号以 EX 开头，一单可能多料次 |
| `OA辅助单` | 正式名 | 全集团 OA 辅助单（注塑单），订单号不限 |
| `工艺实验` | 别名 | 自动展开为 广州工艺实验 + 上海工艺实验 |
| `研发实验` | 别名 | = 小试 |
| `送样` / `小订单` | 别名 | = 广州送样&小订单 |
| `注塑单` / `研发辅助单` | 别名 | = OA辅助单 |

### 3.3 响应参数表（成功，HTTP 200）

| 层级 | 参数名 | 类型 | 说明 |
|---|---|---|---|
| 1 | ok | boolean | 是否成功取得数据（`true` = 命中订单） |
| 2 | order_no | string | 请求的订单号原样回显 |
| 3 | bases_queried | array[string] | 本次实际查询的业务范围列表 |
| 4 | matches | array[object] | 命中的结果数组，每个元素对应一个命中的业务范围 |
| 4.1 | base | string | 命中的业务范围（5 个正式名之一） |
| 4.2 | order_no | string | 订单号 |
| 4.3 | rows | array[object] | 进度数据行，字段明细见 3.4。广州/小试/OA 通常 1 行；上海工艺实验一单多料次时多行 |
| 4.4 | found | boolean | 恒为 `true` |
| 5 | match_count | int | matches 长度。通常为 1；>1 表示同一单号在多个业务范围命中 |
| 6 | note | string | 多范围命中时的提示文案（可能不返回） |
| 7 | warnings | array[object] | 部分业务范围 SQL 失败但有命中时返回（元素为 `{base, error}`），表示结果覆盖不全 |

### 3.4 rows 字段明细

| 字段名 | 中文含义 | 类型 | 适用业务范围 | 备注 |
|---|---|---|---|---|
| order_no | 订单编号 | string | 全部 | |
| 牌号 | 产品牌号 | string | 全部 | 字段名即中文 |
| 产品线 | 所属产品线 | string | 全部 | 字段名即中文 |
| machine | 机台 | string | 全部 | 生产机台编号 |
| order_count | 数量 / 料次号 | int | 全部 | 上海工艺实验中表示**料次号**（可能不连续），其余表示订单数量 |
| 技术员 | 技术员 | string | 广州两类 / 小试 / OA辅助单 | 字段名即中文；**上海工艺实验无此字段**，技术员记录在 `技术配方备注` 里 |
| 技术配方备注 | 技术配方备注 | string | 上海工艺实验 | 字段名即中文，内含技术员信息，需从文本中提取 |
| base | 基地 | string | 小试 / OA辅助单 | 广州、上海隐含，不返回此字段 |
| creator | 开单人员 | string | 广州两类 | 岗位固定值 |
| create_order_time | 开单时间 | string | 广州两类 | |
| scheduling_person | 排产完成人员 | string | 全部 | 广州两类/上海为岗位固定值 |
| scheduling_time | 排产完成时间 | string | 全部 | |
| color_powder_measurer | 色粉计量人员 | string | 广州两类 / 上海 | 岗位固定值；小试 / OA 无此工序 |
| color_powder_measure_time | 色粉计量时间 | string | 广州两类 / 上海 | |
| mixing_person | 混料人员 | string | 广州两类 / 小试 / 上海 | 小试为实时真实记录 |
| mixing_time | 混料时间 | string | 广州两类 / 小试 / 上海 | |
| extrusion_person | 挤出人员 | string | 广州两类 / 小试 / 上海 | 小试为实时真实记录 |
| extrusion_time | 挤出时间 | string | 广州两类 / 小试 / 上海 | |
| extrusion_exception | 挤出异常 | string | 广州两类 / 小试 / 上海 | 空字符串 = 无异常；OA 无此字段 |
| injection_color_plate_person | 注塑色板人员 | string | 广州两类 / 上海 | 小试 / OA 无此工序 |
| injection_color_plate_time | 注塑色板时间 | string | 广州两类 / 上海 | |
| injection_color_plate_exception | 注塑色板异常 | string | 广州两类 / 上海 | 空字符串 = 无异常 |
| injection_strip_person | 注塑样条人员 | string | 全部 | OA 的注塑人员即此字段 |
| injection_strip_time | 注塑样条时间 | string | 全部 | |
| injection_strip_exception | 注塑样条异常 | string | 全部 | 空字符串 = 无异常 |
| final_monitor | 最终班长 | string | 广州两类 / 小试 / 上海 | OA 无此字段 |
| final_complete_time | 最终完成时间 | string | 广州两类 / 小试 / 上海 | 完成信号字段（上海看最后料次）。**未完成/未记录返回 `null`** |
| status | 订单状态 | string | 全部 | `已完成` / `生产中`，由服务端按该类型完成信号判定（小试 = 注塑完成时间；其余 = 最终完成时间；上海逐料次） |
| current_stage | 当前所在工序 | string\|null | 广州两类/小试/上海/OA | `生产中` 时为"最后一个已完成工序的下一步"；全程无工序记录时为该类型第一个做工节点；`已完成` 时为 `null`。**对接方展示此字段，勿自行推断** |
| current_stage_person | 当前工序负责人 | string\|null | 同上 | 对应当前工序的负责人；未记录为 `null` |
| stages | 工序明细 | array[object] | 全部 | 按工序顺序排列，每项 `{ node: 工序名, person: 负责人, time: 完成时间, done: boolean }`；`done=false` = 该工序尚未完成 |

> 说明：广州两类有 `stages` = 色粉计量→混料→挤出→注塑色板→注塑样条→最终班长；小试无注塑色板、以注塑样条(注塑完成时间)收尾；上海每行（料次）独立装饰；OA 仅注塑工序。

### 3.5 特殊值约定

| 值 | 含义 |
|---|---|
| `null` | 时间字段：该工序**尚未执行**/未记录（历史库的 `"1900-01-01 00:00"`、`""` 哨兵已统一归一为 `null`，不再出现）；人员字段：无记录 |
| `""`（空字符串） | **仅异常字段**可能出现：表示**无异常** |
| 时间字符串 | 统一为北京时间 `"YYYY-MM-DD HH:mm"` |

**状态与节点**：直接使用行里的 `status` / `current_stage` / `stages[]`，不要再从各工序时间自己推断——源 ERP 的色粉计量时间等列记录率极低（近 3 个月仅约 3.6%），拿"第一个未完成的工序"当当前节点会把几乎所有订单（含已完成/已挤出）误判为停在色粉称量（本次已实证）。
- `status=已完成` → 直接展示完成状态，忽略 `current_stage`（恒为 `null`）
- `status=生产中` → 展示 `current_stage`（当前工序）与 `current_stage_person`（负责人）
- `stages[]` 的 `done` 可用于绘制工序进度条/时间线

## 4. 示例

### 4.1 请求示例

```bash
# 不确定订单归属：不传 base，并行查全部 5 个业务范围
curl -G 'http://172.19.42.245:8001/open/orders/progress' \
  --header 'Authorization: Bearer sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473' \
  --data-urlencode 'order_no=EX20260804-1042'

# 已知是工艺实验单：传别名，自动展开为 广州工艺实验 + 上海工艺实验（更快）
curl -G 'http://172.19.42.245:8001/open/orders/progress' \
  --header 'Authorization: Bearer sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473' \
  --data-urlencode 'order_no=EX20260804-1042' \
  --data-urlencode 'base=工艺实验'
```

等价 URL（base 已编码）：

```
GET /open/orders/progress?order_no=EX20260804-1042&base=%E5%B7%A5%E8%89%BA%E5%AE%9E%E9%AA%8C
```

### 4.2 成功响应示例

【注意】成功响应需同时满足：【接口联通成功】HTTP 状态码 200，且【业务标识成功】`"ok": true`。

```json
{
    "ok": true,
    "order_no": "EX20260804-1042",
    "bases_queried": ["广州工艺实验", "广州送样&小订单", "小试", "上海工艺实验", "OA辅助单"],
    "matches": [
        {
            "base": "广州工艺实验",
            "order_no": "EX20260804-1042",
            "rows": [
                {
                    "order_no": "EX20260804-1042",
                    "技术员": "晏允光",
                    "牌号": "PPE-JF206 BK017",
                    "产品线": "工艺装备部",
                    "machine": "Z8-07",
                    "order_count": 1,
                    "extrusion_exception": "",
                    "injection_strip_exception": "",
                    "injection_color_plate_exception": "",
                    "creator": "王武龙",
                    "create_order_time": null,
                    "color_powder_measurer": "冉海淘/贺建平",
                    "color_powder_measure_time": null,
                    "mixing_person": "邹华明",
                    "mixing_time": "2026-08-07 02:19",
                    "extrusion_person": "邹华明",
                    "extrusion_time": "2026-08-09 07:05",
                    "injection_color_plate_person": "刘富贵",
                    "injection_color_plate_time": null,
                    "injection_strip_person": "杨文超",
                    "injection_strip_time": null,
                    "final_monitor": "邹华明",
                    "final_complete_time": "2026-08-09 07:16",
                    "scheduling_time": "2026-08-06 10:31",
                    "scheduling_person": "杨东东",
                    "status": "已完成",
                    "current_stage": null,
                    "current_stage_person": null,
                    "stages": [
                        { "node": "色粉计量", "person": "冉海淘/贺建平", "time": null, "done": false },
                        { "node": "混料", "person": "邹华明", "time": "2026-08-07 02:19", "done": true },
                        { "node": "挤出", "person": "邹华明", "time": "2026-08-09 07:05", "done": true },
                        { "node": "注塑色板", "person": "刘富贵", "time": null, "done": false },
                        { "node": "注塑样条", "person": "杨文超", "time": null, "done": false },
                        { "node": "最终班长", "person": "邹华明", "time": "2026-08-09 07:16", "done": true }
                    ]
                }
            ],
            "found": true
        }
    ],
    "match_count": 1
}
```

解读：`status=已完成`（最终完成时间 2026-08-09 07:16 有效）→ 直接展示完成状态，`current_stage` 为 `null`。注意色粉计量/注塑色板/注塑样条时间为 `null`（历史库未记录，不代表订单停在那里）——所以不能按工序时间推断节点，看 `status` 和 `current_stage` 即可。三个异常字段均为空 = 无异常。

### 4.3 错误响应示例

【1】认证错误（HTTP 401）——未带 Authorization 头或 Key 错误

```json
{
    "ok": false,
    "error": {
        "code": "UNAUTHORIZED",
        "message": "Invalid or missing API key"
    }
}
```

【2】参数错误（HTTP 400）——缺 order_no 或 base 无法识别（message 附可用关键词清单）

```json
{
    "ok": false,
    "error": {
        "code": "MISSING_PARAM",
        "message": "缺少必填参数 order_no（订单编号）"
    }
}
```

```json
{
    "ok": false,
    "error": {
        "code": "INVALID_PARAM",
        "message": "无法识别的业务类型: 不存在的类型。可用关键词: 广州工艺实验, 广州送样&小订单, 小试, 上海工艺实验, oa辅助单, 研发实验, 工艺实验, 注塑单, 研发辅助单, 送样, 小订单"
    }
}
```

【3】订单未找到（HTTP 404）——查无此单，**或订单最近 3 个月内无工序活动被数据窗口过滤**；若附 `db_errors` 说明部分范围查询失败（可稍后重试）

```json
{
    "ok": false,
    "error": {
        "code": "ORDER_NOT_FOUND",
        "message": "5 个业务范围均未找到订单 EX9999999",
        "hint": "请确认订单号是否正确。可查询的业务范围: 广州工艺实验, 广州送样&小订单, 小试, 上海工艺实验, OA辅助单"
    },
    "order_no": "EX9999999",
    "bases_queried": ["广州工艺实验", "广州送样&小订单", "小试", "上海工艺实验", "OA辅助单"]
}
```

【4】服务端异常（HTTP 500 / 503）

```json
{
    "ok": false,
    "error": {
        "code": "DB_ERROR",
        "message": "SQL Server 查询失败",
        "details": [{ "base": "上海工艺实验", "error": "..." }]
    }
}
```

```json
{
    "ok": false,
    "error": {
        "code": "SERVICE_UNAVAILABLE",
        "message": "OPEN_API_KEY 未配置，/open/* 对外接口已禁用"
    }
}
```

**错误码汇总**

| HTTP 状态码 | 错误码（code） | 描述 | 调用方处理建议 |
|---|---|---|---|
| 400 | MISSING_PARAM | 缺 order_no | 检查请求参数 |
| 400 | INVALID_PARAM | order_no 超长或 base 无法识别 | 修正参数（message 附可用关键词） |
| 401 | UNAUTHORIZED | Key 缺失或无效 | 检查 Authorization 头与 Key |
| 404 | ORDER_NOT_FOUND | 查无此单，或订单最近 3 个月内无工序活动 | 确认单号与订单活跃时间；有 db_errors 时可重试 |
| 500 | DB_ERROR | 生产库查询失败 | 重试；持续失败联系中试运维 |
| 503 | SERVICE_UNAVAILABLE | 服务端未启用开放接口 | 联系中试运维 |

## 5. 常见问题

| 问题 | 答案 |
|---|---|
| 以前能查到的订单现在 404 了？ | 该订单最近 3 个月内没有任何工序活动（已完成归档或长期停滞），被数据窗口过滤。服务端硬限制，无法通过参数绕过 |
| 同一单号返回多条 matches？ | 该单号在不同业务范围重复存在，按 `note` 提示人工确认；可用 `base` 指定范围复查 |
| 上海的订单 rows 有多行？ | 一行 = 一个料次，`order_count` 是料次号；整单状态看**料次号最大那行** |
| 为什么有的时间全是 null（以前是 1900-01-01）？ | 该工序尚未执行/未记录。接口从 2026-08 起把历史库的 `"1900-01-01 00:00"`、空串统一归一为 `null`，见 3.5 特殊值约定 |
| 工序节点怎么判断（色粉称量/混料/挤出…）？ | 直接用行级 `status` + `current_stage` + `stages[]`，不要自行推断——色粉计量等工序时间在源 ERP 记录率极低，自行推断会把所有单误判为停在色粉称量 |
| 想要按技术员/时间批量查订单？ | 使用接口二 `GET /open/orders/list`，见第 7 节 |

## 6. 调用代码示例

### Python（requests）

```python
import requests

API = "http://172.19.42.245:8001/open/orders/progress"
KEY = "sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473"

def query_progress(order_no: str, base: str | None = None) -> dict | None:
    resp = requests.get(
        API,
        params={"order_no": order_no, **({"base": base} if base else {})},
        headers={"Authorization": f"Bearer {KEY}"},
        timeout=30,
    )
    if resp.status_code == 200:
        return resp.json()
    if resp.status_code == 404:
        return None  # 查无此单（或超出 3 个月数据窗口）
    resp.raise_for_status()  # 401/400/500 等抛异常，resp.json()["error"] 含错误码

data = query_progress("EX20260804-1042")
if data:
    for m in data["matches"]:
        for row in m["rows"]:
            print(m["base"], row.get("牌号"), row.get("final_complete_time"))
```

### JavaScript / Node（fetch）

```javascript
const KEY = "sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473";
const url = new URL("http://172.19.42.245:8001/open/orders/progress");
url.searchParams.set("order_no", "EX20260804-1042");

const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
if (res.status === 200) {
  const { matches } = await res.json();
  for (const { base, rows } of matches) {
    for (const row of rows) console.log(base, row["牌号"], row.final_complete_time);
  }
} else if (res.status === 404) {
  console.log("查无此单");
} else {
  console.error((await res.json()).error); // { code, message }
}
```

---

## 7. 接口二：订单列表查询（GET /open/orders/list）

按技术员 / 牌号 / 产品线 / 业务类型 / 基地 / 排产时间范围批量查询订单**摘要**列表。与接口一共享鉴权（第 2 节）与【注意事项】（同样是最近 3 个月数据窗口）。

> 工序级明细（各工序人员/时间）请用命中结果里的订单号调接口一。

### 7.1 接口描述

| 项目 | 内容 |
|---|---|
| 接口名称 | 中试订单列表查询 |
| 接口功能 | 按多维条件批量查询最近 3 个月内有工序活动的订单摘要（单号、机台、牌号、技术员、状态、异常等） |
| 接口地址 | `http://172.19.42.245:8001/open/orders/list` |
| 请求方式 | GET |
| Content-Type | application/json（响应） |
| 字符编码 | UTF-8 |
| 认证方式 | Bearer Token（同接口一） |

### 7.2 请求参数表（Query String，全部可选——不传任何参数 = 查全部 5 类近 3 个月订单）

| 层级 | 参数名 | 类型 | 必填 | 说明 | 默认值 |
|---|---|---|---|---|---|
| 1 | business_types | string | 否 | 业务类型或别名，逗号分隔可传多个（如 `工艺实验,小试`），取值见 3.2 base 取值表 | 全部 5 类 |
| 2 | technician | string | 否 | 技术员姓名，模糊匹配（上海工艺实验按「技术配方备注」文本匹配） | - |
| 3 | base | string | 否 | 地理基地，如 `广州` / `上海`；仅对全集团类型（小试 / OA辅助单）生效 | - |
| 4 | grade | string | 否 | 产品牌号，模糊匹配 | - |
| 5 | product_line | string | 否 | 产品线，模糊匹配 | - |
| 6 | since | string | 否 | 排产时间起，格式 `YYYY-MM-DD`（含当天） | 窗口下界 |
| 7 | until | string | 否 | 排产时间止，格式 `YYYY-MM-DD`（含当天） | 今天 |
| 8 | limit | int | 否 | 每个业务类型最大返回行数，1~1000 | 200 |

> **时间过滤按「排产时间」**；`since` 传得再早也不会突破最近 3 个月数据窗口。

### 7.3 响应参数表（成功，HTTP 200）

| 层级 | 参数名 | 类型 | 说明 |
|---|---|---|---|
| 1 | ok | boolean | 是否成功 |
| 2 | bases_queried | array[string] | 本次实际查询的业务范围 |
| 3 | total | int | 各类型返回行数之和 |
| 4 | results | array[object] | 每个业务类型一个元素（含未发查询的跳过说明） |
| 4.1 | type | string | 业务类型 |
| 4.2 | count | int | 该类型返回的订单数 |
| 4.3 | truncated | boolean | **是否被 limit 截断**——`true` 表示该类型实际数据多于返回行数，建议用 since/until 收窄时间段分段拉取 |
| 4.4 | rows | array[object] | 订单摘要行，字段见 7.4 |
| 4.5 | skipped | string | 未发查询的原因（如请求基地与类型隐含基地冲突，可能不返回） |
| 4.6 | error | string | 该类型 SQL 失败原因（部分失败时其他类型仍正常返回，可能不返回） |

### 7.4 rows 字段明细（订单摘要）

| 字段名 | 中文含义 | 类型 | 备注 |
|---|---|---|---|
| order_no | 订单号 | string | |
| type | 命中的业务类型 | string | 5 个正式名之一 |
| base | 基地 | string | 广州两类/上海固定为 广州/上海；小试/OA 为订单实际基地 |
| machine | 机台 | string | |
| order_count | 数量 / 料次总数 | int | 上海工艺实验聚合后为料次总数 |
| technician | 技术员 | string | 上海工艺实验为 null（技术员在 tech_remark 里） |
| tech_remark | 技术配方备注 | string | 仅上海工艺实验有值，技术员需从此文本提取 |
| grade | 产品牌号 | string | |
| product_line | 产品线 | string | |
| create_order_time | 开单时间 | string | 可能为 1900（未记录）或 null（上海/OA 无此字段） |
| scheduling_time | 排产时间 | string | |
| status | 订单状态 | string | `已完成` / `生产中`（上海按最后料次判定整单） |
| extrusion_exception | 挤出异常原始值 | string | 空 = 无异常（OA 恒为空） |
| injection_strip_exception | 注塑样条异常原始值 | string | 空 = 无异常 |
| injection_color_plate_exception | 注塑色板异常原始值 | string | 空 = 无异常（小试/OA 恒为空） |
| exceptions | 异常工序列表 | array[string] | 已解析：如 `["挤出", "注塑样条"]`；**空数组 = 无异常**，建议直接用此字段 |
| lot_total | 料次总数 | int | 仅上海工艺实验（一单多料次已聚合到订单级） |
| lot_completed | 已完成料次数 | int | 仅上海工艺实验 |

### 7.5 示例

```bash
# 全部 5 类近 3 个月订单（每类最多 200 条）
curl -G 'http://172.19.42.245:8001/open/orders/list' \
  --header 'Authorization: Bearer sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473'

# 按技术员 + 时间：张三近 30 天排产的订单
curl -G 'http://172.19.42.245:8001/open/orders/list' \
  --header 'Authorization: Bearer sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473' \
  --data-urlencode 'technician=张三' \
  --data-urlencode 'since=2026-07-13'

# 按类型别名 + 牌号：工艺实验类里牌号含 ABC 的订单
curl -G 'http://172.19.42.245:8001/open/orders/list' \
  --header 'Authorization: Bearer sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473' \
  --data-urlencode 'business_types=工艺实验' \
  --data-urlencode 'grade=ABC'

# 按产品线：工艺装备部产品线的订单（每类最多 200 条）
curl -G 'http://172.19.42.245:8001/open/orders/list' \
  --header 'Authorization: Bearer sk-open-ee79d33fc662ad3d5a02605d38aa20320bca38b5b7700473' \
  --data-urlencode 'product_line=工艺装备部'
```

成功响应示例（节选）：

```json
{
    "ok": true,
    "bases_queried": ["广州工艺实验", "上海工艺实验"],
    "total": 4,
    "results": [
        {
            "type": "广州工艺实验",
            "count": 3,
            "truncated": false,
            "rows": [
                {
                    "order_no": "EX20260805-1052",
                    "base": "广州",
                    "machine": "Z8-19",
                    "order_count": 1,
                    "technician": "邱贤亮",
                    "tech_remark": null,
                    "grade": "YBL-TPG5811 NC001",
                    "product_line": "RJ",
                    "create_order_time": "1900-01-01 00:00",
                    "scheduling_time": "2026-08-12 15:22",
                    "status": "生产中",
                    "extrusion_exception": "",
                    "injection_strip_exception": "",
                    "injection_color_plate_exception": "",
                    "type": "广州工艺实验",
                    "exceptions": []
                }
            ]
        }
    ]
}
```

参数错误（未知类型 / 日期格式 / since 晚于 until）返回 400 `INVALID_PARAM`，格式同第 4.3 节【2】。

### 7.6 拉取建议

- 接口**无 offset 分页**：单类型最多 `limit`（≤1000）行；响应里 `truncated=true` 表示没拉全，用 `since`/`until` 收窄时间段分段拉（如按周）
- 增量同步场景：每天拉 `since=昨天&until=今天`，数据量小且不会截断
- 拿到感兴趣的订单号后，用接口一获取工序级明细
