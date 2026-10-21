/**
 * 对外开放接口（供其他系统程序化调用）
 *
 * GET /open/orders/progress?order_no=XXX&base=YYY
 * - 直连 SQL Server 数据层查询订单生产进度，返回结构化 JSON
 * - 只读、@orderNo 参数化绑定，不经 LLM / 工具层
 *   （工具层 SQL 失败时会降级返回 mock 数据，绝不能给到外部系统）
 * - 鉴权依赖外层 index.ts 的 OPEN_API_KEY Bearer 中间件（未配置时 fail-closed 503）
 */

import { Hono } from "hono";
import {
  queryOrderProgressMany,
  queryOrdersList,
  resolveBusinessTypes,
  ALL_BASE_NAMES,
  DEFAULT_LIST_LIMIT,
  type BaseName,
  type OrderProgressResult,
} from "pi-agent";
import { createLogger } from "../services/logger";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const logger = createLogger("open-api");

/** 订单号长度上限（卫生校验，真实订单号远短于此） */
const MAX_ORDER_NO_LEN = 64;

/** 列表查询每业务类型返回上限（数据窗口为近 3 个月，超量时用 since/until 收窄时间分段拉取） */
const MAX_LIST_LIMIT = 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 查询审计落盘日志：外部接口的调用记录需可追溯（谁在何时查了哪个订单、结果如何） */
const REQ_LOG = path.resolve(process.cwd(), "data", "logs", "open-api-requests.jsonl");

/** 落盘一条审计事件（401 鉴权失败也记录，用于发现暴力探测）。日志失败不影响请求。 */
export function logOpenApiEvent(entry: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(REQ_LOG), { recursive: true });
    appendFileSync(REQ_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // 日志失败不影响请求
  }
}

type ResultWithError = OrderProgressResult & { error: string };

export function openApiRoute(): Hono {
  const app = new Hono();

  app.get("/orders/progress", async (c) => {
    const started = Date.now();

    // ── 1. order_no 校验 ──
    const orderNo = (c.req.query("order_no") ?? "").trim();
    if (!orderNo) {
      return c.json(
        { ok: false, error: { code: "MISSING_PARAM", message: "缺少必填参数 order_no（订单编号）" } },
        400,
      );
    }
    if (orderNo.length > MAX_ORDER_NO_LEN) {
      return c.json(
        { ok: false, error: { code: "INVALID_PARAM", message: `order_no 过长（最多 ${MAX_ORDER_NO_LEN} 字符）` } },
        400,
      );
    }

    // ── 2. base 解析（支持正式名/别名；base=a&base=b 与逗号分隔；不传 = 查全部）──
    const baseInputs =
      c.req
        .queries("base")
        ?.flatMap((s) => s.split(","))
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    let bases: BaseName[];
    try {
      bases = resolveBusinessTypes(baseInputs.length > 0 ? baseInputs : undefined);
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: "INVALID_PARAM",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        400,
      );
    }

    // ── 3. 直连数据层并行查询（无 mock 降级）──
    let results: Array<OrderProgressResult | ResultWithError>;
    try {
      results = await queryOrderProgressMany(orderNo, bases);
    } catch (err) {
      // getPool 级别的致命错误（如 SQL 配置缺失）
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Open API query failed", { orderNo, bases, error: msg });
      logOpenApiEvent({
        event: "query",
        order_no: orderNo,
        bases,
        status: 500,
        duration_ms: Date.now() - started,
      });
      return c.json(
        { ok: false, error: { code: "DB_ERROR", message: "SQL Server 查询失败", detail: msg } },
        500,
      );
    }

    // ── 4. 分拣结果：命中 / SQL 失败 / 未找到 ──
    const matches = results.filter((r) => r.found && !("error" in r));
    const dbErrors = results
      .filter((r): r is ResultWithError => "error" in r)
      .map((r) => ({ base: r.base, error: r.error }));
    const status = matches.length > 0 ? 200 : dbErrors.length === results.length ? 500 : 404;
    const duration = Date.now() - started;

    logOpenApiEvent({
      event: "query",
      order_no: orderNo,
      bases,
      status,
      match_count: matches.length,
      duration_ms: duration,
    });

    // 所查业务类型全部 SQL 失败 → 500（不能谎报"未找到"）
    if (matches.length === 0 && dbErrors.length === results.length) {
      logger.error("Open API all bases failed", { orderNo, dbErrors });
      return c.json(
        {
          ok: false,
          error: { code: "DB_ERROR", message: "SQL Server 查询失败", details: dbErrors },
        },
        500,
      );
    }

    // 命中 ≥1 个业务类型 → 200（部分类型 SQL 失败时附 warnings）
    if (matches.length > 0) {
      logger.info("Open API order found", {
        orderNo,
        matchCount: matches.length,
        durationMs: duration,
      });
      return c.json({
        ok: true,
        order_no: orderNo,
        bases_queried: bases,
        matches,
        match_count: matches.length,
        ...(matches.length > 1
          ? { note: "同一订单号在多个业务范围命中，请确认" }
          : {}),
        ...(dbErrors.length > 0 ? { warnings: dbErrors } : {}),
      });
    }

    // 全部查无此单 → 404（部分类型 SQL 失败时附 db_errors，诚实表达"没找到可能是没查成"）
    logger.info("Open API order not found", { orderNo, bases, durationMs: duration });
    return c.json(
      {
        ok: false,
        error: {
          code: "ORDER_NOT_FOUND",
          message: `${bases.length} 个业务范围均未找到订单 ${orderNo}`,
          hint: `请确认订单号是否正确。可查询的业务范围: ${ALL_BASE_NAMES.join(", ")}`,
        },
        order_no: orderNo,
        bases_queried: bases,
        ...(dbErrors.length > 0 ? { db_errors: dbErrors } : {}),
      },
      404,
    );
  });

  // ── 订单列表查询（近 3 个月，支持多维过滤；数据窗口由数据层强制） ──
  app.get("/orders/list", async (c) => {
    const started = Date.now();

    // ── 1. business_types 解析（正式名/别名，逗号分隔或重复参数；不传 = 全部 5 类） ──
    const typeInputs =
      c.req
        .queries("business_types")
        ?.flatMap((s) => s.split(","))
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    let types: BaseName[];
    try {
      types = resolveBusinessTypes(typeInputs.length > 0 ? typeInputs : undefined);
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: "INVALID_PARAM",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        400,
      );
    }

    // ── 2. 可选过滤条件 ──
    const technician = c.req.query("technician")?.trim() || undefined;
    const base = c.req.query("base")?.trim() || undefined;
    const grade = c.req.query("grade")?.trim() || undefined;
    const product_line = c.req.query("product_line")?.trim() || undefined;
    const since = c.req.query("since")?.trim() || undefined;
    const until = c.req.query("until")?.trim() || undefined;

    if (since && !DATE_RE.test(since)) {
      return c.json(
        { ok: false, error: { code: "INVALID_PARAM", message: `since 格式无效（应为 YYYY-MM-DD）: ${since}` } },
        400,
      );
    }
    if (until && !DATE_RE.test(until)) {
      return c.json(
        { ok: false, error: { code: "INVALID_PARAM", message: `until 格式无效（应为 YYYY-MM-DD）: ${until}` } },
        400,
      );
    }
    if (since && until && since > until) {
      return c.json(
        { ok: false, error: { code: "INVALID_PARAM", message: `since (${since}) 不能晚于 until (${until})` } },
        400,
      );
    }

    // ── 3. limit（默认 200，上限 1000） ──
    let limit = DEFAULT_LIST_LIMIT;
    const limitRaw = c.req.query("limit")?.trim();
    if (limitRaw) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 1) {
        return c.json(
          { ok: false, error: { code: "INVALID_PARAM", message: `limit 无效（应为正整数）: ${limitRaw}` } },
          400,
        );
      }
      limit = Math.min(n, MAX_LIST_LIMIT);
    }

    // ── 4. 数据层并行查询（3 个月窗口在 SQL 层强制） ──
    const filters = { types, technician, base, grade, product_line, since, until, limit };
    let results;
    let total: number;
    try {
      ({ results, total } = await queryOrdersList(filters));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Open API list query failed", { types, error: msg });
      logOpenApiEvent({ event: "list", types, status: 500, duration_ms: Date.now() - started });
      return c.json(
        { ok: false, error: { code: "DB_ERROR", message: "SQL Server 查询失败", detail: msg } },
        500,
      );
    }

    const allFailed = results.length > 0 && results.every((r) => r.error);
    const status = allFailed ? 500 : 200;
    logOpenApiEvent({
      event: "list",
      types,
      filters: { technician, base, grade, product_line, since, until, limit },
      total,
      status,
      duration_ms: Date.now() - started,
    });

    if (allFailed) {
      logger.error("Open API list all types failed", {
        types,
        errors: results.map((r) => ({ type: r.type, error: r.error })),
      });
      return c.json(
        {
          ok: false,
          error: {
            code: "DB_ERROR",
            message: "SQL Server 查询失败",
            details: results.map((r) => ({ type: r.type, error: r.error })),
          },
        },
        500,
      );
    }

    logger.info("Open API list queried", { types, total, durationMs: Date.now() - started });
    return c.json({ ok: true, bases_queried: types, total, results });
  });

  return app;
}
