/**
 * SQL Server Service
 *
 * 连接中试生产管理 SQL Server，提供订单进度真实查询。
 *
 * - 单例连接池（首次调用懒加载）
 * - 5 个业务类型对应 5 套 SQL 模板
 * - 参数化查询，防 SQL 注入
 * - 连接失败 / 查询失败时抛出明确错误（上层工具可捕获降级）
 */

import sql from "mssql";

// ============================================
// 配置
// ============================================

export interface SqlConfig {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** 从环境变量读取 SQL 配置 */
export function getSqlConfig(): SqlConfig {
  const server = process.env.SQL_HOST;
  const database = process.env.SQL_DB;
  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;
  const port = Number(process.env.SQL_PORT) || 1433;

  if (!server || !database || !user || !password) {
    throw new Error(
      "SQL Server 配置缺失。请在 pi_agent/.env 中设置:\n" +
      "  SQL_HOST, SQL_PORT, SQL_DB, SQL_USER, SQL_PASSWORD",
    );
  }
  return { server, port, database, user, password };
}

// ============================================
// 连接池单例
// ============================================

let _pool: sql.ConnectionPool | null = null;
let _connecting: Promise<sql.ConnectionPool> | null = null;

/** 获取/初始化连接池（懒加载 + 缓存） */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (_pool && _pool.connected) return _pool;
  if (_connecting) return _connecting;

  const cfg = getSqlConfig();
  _connecting = new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: false,                  // 内网 SQL Server 通常不强制 TLS
      trustServerCertificate: true,    // 信任自签名证书
      enableArithAbort: true,
      connectTimeout: 10_000,
      requestTimeout: 30_000,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 60_000,
    },
  })
    .connect()
    .then((pool: sql.ConnectionPool) => {
      _pool = pool;
      _connecting = null;
      pool.on("error", (err: Error) => {
        console.error("[sqlServer] pool error:", err);
        _pool = null;
      });
      return pool;
    })
    .catch((err: Error) => {
      _connecting = null;
      throw err;
    });

  return _connecting;
}

/** 关闭连接池（用于 server 进程退出时清理） */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.close();
    _pool = null;
  }
}


// ── 业务范围（声明式知识统一在 businessScopes.ts） ──
import { ALL_BASE_NAMES, BUSINESS_SCOPES } from "./businessScopes.js";
import type { BaseName, OrderListSpec, StageInfo } from "./businessScopes.js";

export {
  ALL_BASE_NAMES,
  BUSINESS_TYPE_ALIASES,
  BUSINESS_SCOPES,
  resolveBusinessTypes,
  scopeOf,
  type BaseName,
  type BusinessScope,
  type StageInfo,
} from "./businessScopes.js";

// ============================================
// 查询函数
// ============================================

/**
 * 把驱动返回的 Date 还原为库里的墙钟时间字符串 "YYYY-MM-DD HH:mm"。
 *
 * 背景：库里存的是北京时间墙钟值（如 2026-08-05 15:10），mssql 驱动按 UTC 解释
 * （得到 2026-08-05T15:10Z），直接 JSON 序列化会带 Z 后缀，LLM 常误做 +8 时区
 * 换算导致时间差 8 小时。此处按 UTC 分量原样格式化即可还原存储值。
 * 不依赖进程时区（Docker 容器默认 UTC 也不受影响）。
 *
 * 未设置统一归 null：库里的 "1900-01-01 00:00"（或 1899 年、空串）哨兵表示该
 * 时间未记录，对外一律归一为 null——SKILL.md 已约定"视为空"，绝不能把哨兵日期
 * 当真实完成时间交给外部系统（他们会据此误判"当前工序/已完成"）。
 */
export function formatSqlDatetime(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // 1900/1899 哨兵日期 = 未设置
    if (v.getUTCFullYear() <= 1900) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    // 库里 VARCHAR 存储的时间哨兵（如 "1900-01-01 00:00" / "0000-00-00"）
    if (/^(0000|1899|1900)-/.test(s)) return null;
    return s;
  }
  return null;
}

/** 时间字段名白名单：这些字段的来源列是 VARCHAR，库里用 "1900-01-01 00:00"/空串 存"未设置" */
const TIME_FIELD_KEYS = new Set([
  "create_order_time",
  "scheduling_time",
  "color_powder_measure_time",
  "mixing_time",
  "extrusion_time",
  "injection_color_plate_time",
  "injection_strip_time",
  "final_complete_time",
  "注塑完成时间",
]);

/**
 * 行内 Date/时间字段统一还原为墙钟时间字符串，"未设置"（Date 哨兵 / "" / "1900-*"）
 * 一律归 null——对时间字段必须连字符串一起归一，否则 VARCHAR 列里漏写的哨兵会以
 * 假日期形式漏到外部系统（对接方据此误判工序完成）。
 */
function normalizeRowDates(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(row)) {
    if (row[key] instanceof Date || TIME_FIELD_KEYS.has(key)) row[key] = formatSqlDatetime(row[key]);
  }
  return row;
}

/**
 * 给点查单行补工序语义字段（纯函数，便于单测）：
 * - `stages[]`：各工序 { node, person, time, done }
 * - `status`：`已完成` / `生产中`（按该类型的完成信号判定，非"看是否有时间"）
 * - `current_stage` / `current_stage_person`：生产中时 = 最后一个已完成工序的
 *   下一步；全程无任何工序记录时 = 第一个做工节点（分不清"开了单没动"与"没开始"，
 *   给同位节点，让对接方显示"未开始任何工序"）
 * - 完成时 current_stage 为 null（对接方应展示 status，不再取节点）
 */
export function decorateProgressRow(
  type: BaseName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const specs = BUSINESS_SCOPES[type]?.stages ?? [];
  const stages: StageInfo[] = specs.map((s) => {
    const time = row[s.time] == null ? null : String(row[s.time]);
    const person = s.person == null || row[s.person] == null ? null : String(row[s.person]);
    return { node: s.node, person, time, done: time !== null };
  });
  const done = row[BUSINESS_SCOPES[type]?.completeKey ?? "final_complete_time"] != null;
  let current: StageInfo | null = null;
  if (!done) {
    const lastDone = stages.reduce((acc, st, i) => (st.done ? i : acc), -1);
    // 无任何工序记录 → 停在第一个做工节点（未开始任何工序）
    if (lastDone === -1) current = stages[0] ?? null;
    else if (lastDone + 1 < stages.length) current = stages[lastDone + 1];
  }
  return {
    ...row,
    stages,
    status: done ? "已完成" : "生产中",
    current_stage: current?.node ?? null,
    current_stage_person: current?.person ?? null,
  };
}

export interface OrderProgressResult {
  base: BaseName;
  order_no: string;
  rows: Record<string, unknown>[];
  found: boolean;
}

/**
 * 查询指定业务类型下指定订单的进度。
 *
 * @throws Error 当 base 不在白名单 / SQL 配置缺失 / 连接失败 / 查询失败时
 */
export async function queryOrderProgress(
  orderNo: string,
  base: BaseName,
): Promise<OrderProgressResult> {
  const sqlText = BUSINESS_SCOPES[base]?.detailSql;
  if (!sqlText) {
    throw new Error(`未知业务类型: ${base}。可选: ${ALL_BASE_NAMES.join(", ")}`);
  }

  const pool = await getPool();
  const request = pool.request();
  request.input("orderNo", sql.NVarChar, orderNo);
  // 5 套模板均只用到 @orderNo，业务类型靠订单号模式区分：
  //   广州工艺实验 / 小试 / 上海工艺实验 匹配含 EX 的单号；广州送样&小订单 匹配非 EX 单号
  //   广州两类 / 上海工艺实验 使用硬编码人员名；小试 / OA辅助单 为全集团范围，不绑定 base

  const result = await request.query(sqlText);
  // 归一化（哨兵→null）+ 工序语义装饰（status / current_stage / stages）
  const rows = ((result.recordset || []) as Record<string, unknown>[])
    .map(normalizeRowDates)
    .map((r) => decorateProgressRow(base, r));
  return {
    base,
    order_no: orderNo,
    rows,
    found: rows.length > 0,
  };
}

/**
 * 批量查询多个业务类型（并行发起，互不依赖）
 */
export async function queryOrderProgressMany(
  orderNo: string,
  bases: BaseName[] = ALL_BASE_NAMES,
): Promise<OrderProgressResult[]> {
  return Promise.all(bases.map((b) => queryOrderProgress(orderNo, b).catch((err) => ({
    base: b,
    order_no: orderNo,
    rows: [],
    found: false,
    error: err instanceof Error ? err.message : String(err),
  }))));
}

// ── 未排产订单查询（登记表） ─────────────────────────

/**
 * 未排产订单：排产前订单只登记在以下两张「登记表」里，尚未进入各业务主表。
 *   - tabdiytable7367：集团小试 / 广州工艺实验 / 上海工艺实验（订单号 F126876）
 *   - tabdiytable7293：研发辅助单（订单号 F125422）
 * 说明：登记阶段无法区分「工艺实验 vs 小试」，仅能拿到地域（7367 用 F126862、
 *   7293 用 F126888），因此这里只报告地域与登记信息，不强行归类业务类型。
 */

export interface PendingOrderRecord {
  /** 归属登记表类型（工艺实验/小试 或 OA辅助单） */
  source: "工艺实验/小试" | "OA辅助单";
  order_no: string;
  /** 技术员（7367.F126815 / 7293.F125423） */
  technician: string | null;
  /** 牌号（7367.F126820 下划线前段 / 7293.F125425） */
  grade: string | null;
  /** 地域（7367.F126862 / 7293.F126888），登记阶段可能为空 */
  base: string | null;
  /** 登记时间（FillDate） */
  registered_at: string | null;
}

export interface PendingOrderResult {
  order_no: string;
  status: "待排产";
  found: boolean;
  records: PendingOrderRecord[];
}

/**
 * 查询未排产订单（两表登记表按订单号精确命中，参数化查询）。
 * 主表查不到时由上层调用；found=false 表示该订单号在登记表里也没有记录。
 */
export async function queryPendingOrder(orderNo: string): Promise<PendingOrderResult> {
  const pool = await getPool();
  const normalized = orderNo.trim();

  const [r7367, r7293] = await Promise.all([
    pool.request()
      .input("orderNo", sql.NVarChar, normalized)
      .query(
        // F126820 是「牌号_任务描述_项目类型_类别_序号」拼接串，牌号在下划线之前，
        // 用 SUBSTRING 截取下划线前的部分与主表牌号口径一致（下划线在牌号里也可能出现，
        // 故取第一个下划线为止）。
        `SELECT F126876 AS order_no, F126815 AS technician,
                CASE WHEN CHARINDEX('_', F126820) > 0
                     THEN SUBSTRING(F126820, 1, CHARINDEX('_', F126820) - 1)
                     ELSE F126820 END AS grade,
                F126862 AS base, FillDate AS registered_at
         FROM tabdiytable7367 WHERE F126876 = @orderNo`,
      ),
    pool.request()
      .input("orderNo", sql.NVarChar, normalized)
      .query(
        `SELECT F125422 AS order_no, F125423 AS technician, F125425 AS grade,
                F126888 AS base, FillDate AS registered_at
         FROM tabdiytable7293 WHERE F125422 = @orderNo`,
      ),
  ]);

  const records: PendingOrderRecord[] = [];
  const push = (
    source: PendingOrderRecord["source"],
    rs: readonly Record<string, unknown>[],
  ) => {
    for (const row of rs) {
      const asRow = normalizeRowDates(row);
      records.push({
        source,
        order_no: String(asRow.order_no ?? normalized),
        technician: asRow.technician == null ? null : String(asRow.technician),
        grade: asRow.grade == null ? null : String(asRow.grade),
        base: asRow.base == null ? null : String(asRow.base),
        registered_at: asRow.registered_at == null ? null : String(asRow.registered_at),
      });
    }
  };
  push("工艺实验/小试", r7367.recordset ?? []);
  push("OA辅助单", r7293.recordset ?? []);

  return {
    order_no: normalized,
    status: "待排产",
    found: records.length > 0,
    records,
  };
}

// ── 实时产能负荷统计 ──

export interface CapacitySnapshot {
  baseName: string;       // e.g. "广州基地"
  totalOrders: number;
  pendingOrders: number;  // 未完成
  completedOrders: number;
}

/**
 * 从 SQL Server 实时统计各基地待处理订单数。
 * 聚合 广州中试 + 小试 + OA辅助单 三个数据源。
 * （上海中试 JOIN 太慢暂不纳入，待 SQL 优化）
 */
export async function getRealTimePendingCounts(sinceDays: number = 90): Promise<CapacitySnapshot[]> {
  const pool = await getPool();
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString().slice(0, 10);

  const baseMap = new Map<string, { total: number; pending: number; completed: number }>();

  function add(base: string, total: number, pending: number, completed: number) {
    if (!base) return;
    const existing = baseMap.get(base) || { total: 0, pending: 0, completed: 0 };
    existing.total += total;
    existing.pending += pending;
    existing.completed += completed;
    baseMap.set(base, existing);
  }

  // 广州中试
  try {
    const r = await pool.request().input("s", sql.NVarChar, sinceStr)
      .query(`SELECT
        SUM(CASE WHEN f53419 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN f53419 > '1900-01-02' THEN 1 ELSE 0 END) as completed
      FROM tabdiytable3393 WHERE f52994 > @s`);
    if (r.recordset.length > 0) {
      const row = r.recordset[0];
      add("广州基地", Number(row.pending) + Number(row.completed), Number(row.pending), Number(row.completed));
    }
  } catch (err) {
    console.warn("[capacity] 广州中试 count failed:", err instanceof Error ? err.message : err);
  }

  // 小试（按 base 分组）
  try {
    const r = await pool.request().input("s", sql.NVarChar, sinceStr)
      .query(`SELECT f102925 AS base,
        SUM(CASE WHEN f102963 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN f102963 > '1900-01-02' THEN 1 ELSE 0 END) as completed
      FROM tabdiytable5992 WHERE f102959 > @s
      GROUP BY f102925`);
    for (const row of r.recordset || []) {
      const b = String(row.base || "").trim();
      if (b) {
        const baseName = b + "基地";
        add(baseName, Number(row.pending) + Number(row.completed), Number(row.pending), Number(row.completed));
      }
    }
  } catch (err) {
    console.warn("[capacity] 小试 count failed:", err instanceof Error ? err.message : err);
  }

  // OA辅助单（按 base 分组）
  try {
    const r = await pool.request().input("s", sql.NVarChar, sinceStr)
      .query(`SELECT t2.f138796 AS base,
        SUM(CASE WHEN t.f138978 IS NULL OR t.f138978 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN t.f138978 > '1900-01-02' THEN 1 ELSE 0 END) as completed
      FROM tabdiytable8460 t
      LEFT JOIN tabdiytable8459 t2 ON t.ID = t2.ID
      WHERE t.f138823 > @s
      GROUP BY t2.f138796`);
    for (const row of r.recordset || []) {
      const b = String(row.base || "").trim();
      if (b) {
        const baseName = b + "基地";
        add(baseName, Number(row.pending) + Number(row.completed), Number(row.pending), Number(row.completed));
      }
    }
  } catch (err) {
    console.warn("[capacity] OA count failed:", err instanceof Error ? err.message : err);
  }

  return Array.from(baseMap.entries()).map(([baseName, v]) => ({
    baseName,
    totalOrders: v.total,
    pendingOrders: v.pending,
    completedOrders: v.completed,
  }));
}

// ============================================
// 订单列表查询（多维：技术员 / 基地 / 业务类型 / 排产时间）
// ============================================
//
// 与点查模板的区别：
// - 不查工序人员（无 CROSS JOIN 人员表 / ROW_NUMBER 子查询），只取摘要列，查询更轻
// - WHERE 由构建器按过滤条件动态追加，所有值一律 @param 绑定
// - 时间过滤统一用「排产时间」（5 类唯一共有的时间字段）

export interface OrderListFilters {
  /** 技术员姓名（模糊匹配；上海工艺实验匹配「技术配方备注」文本） */
  technician?: string;
  /** 地理基地（如 广州/上海），仅对全集团类型（小试 / OA辅助单）生效 */
  base?: string;
  /** 产品牌号（模糊匹配） */
  grade?: string;
  /** 产品线（模糊匹配） */
  product_line?: string;
  /** 排产时间起（YYYY-MM-DD） */
  since?: string;
  /** 排产时间止（YYYY-MM-DD，含当天） */
  until?: string;
  /** 每类型最大返回行数（默认 200） */
  limit?: number;
}

export interface BuiltListQuery {
  sql: string;
  /** 需要在 request 上绑定的参数名（@limit 恒在） */
  paramNames: ("tech" | "base" | "grade" | "line" | "since" | "until" | "limit")[];
}

export const DEFAULT_LIST_LIMIT = 200;

/**
 * 构建列表查询 WHERE 条件（pattern + 数据窗口 + 各过滤条件）。
 * 所有用户输入值一律 @param 绑定；LIKE 用服务端 N'%' + @param + N'%' 拼接。
 * 返回的 paramNames 不含 limit（由调用方按需添加）。
 */
function buildListWhere(
  spec: OrderListSpec,
  filters: OrderListFilters,
): { where: string[]; paramNames: string[] } {
  const paramNames: string[] = [];
  // 数据窗口硬限制：无论调用方传什么 since，都只查最近 3 个月内有工序活动的订单
  const where: string[] = [`WHERE ${spec.pattern ?? "1=1"}`, `AND ${spec.windowPredicate}`];

  if (filters.technician) {
    where.push(`AND ${spec.techFilter.col} LIKE N'%' + @tech + N'%'`);
    paramNames.push("tech");
  }
  // base 过滤仅对有基地列的类型（小试 / OA辅助单）生效；固定基地类型在编排层处理
  if (filters.base && spec.baseCol) {
    where.push(`AND ${spec.baseCol} LIKE N'%' + @base + N'%'`);
    paramNames.push("base");
  }
  if (filters.grade) {
    where.push(`AND ${spec.gradeCol} LIKE N'%' + @grade + N'%'`);
    paramNames.push("grade");
  }
  if (filters.product_line) {
    where.push(`AND ${spec.lineCol} LIKE N'%' + @line + N'%'`);
    paramNames.push("line");
  }
  // 排产时间过滤：若排产时间为空（1900 哨兵 / NULL），回退到该类型的
  // 备用时间列（通常为开单时间），使 since/until 与数据窗口口径一致，
  // 避免排产填充率低的业务类型（如广州约 6%）一加时间过滤就整批漏单。
  const timeExpr =
    spec.timeFallbackCol &&
    `CASE WHEN ${spec.schedCol} IS NULL OR ${spec.schedCol} <= '1900-01-02' ` +
      `THEN ${spec.timeFallbackCol} ELSE ${spec.schedCol} END`;
  const schedExpr = timeExpr || spec.schedCol;

  if (filters.since) {
    where.push(`AND ${schedExpr} >= @since`);
    paramNames.push("since");
  }
  if (filters.until) {
    // 含当天：until 日期的次日 00:00 为上界
    where.push(`AND ${schedExpr} < DATEADD(DAY, 1, CAST(@until AS DATETIME2))`);
    paramNames.push("until");
  }

  return { where, paramNames };
}

/**
 * 为指定业务类型构建列表查询 SQL（纯函数，便于单测）。
 * 明细行用 TOP (@limit) 截断；总数/已完成数见 buildOrderListCountQuery（不截断）。
 */
export function buildOrderListQuery(
  type: BaseName,
  filters: OrderListFilters,
): BuiltListQuery {
  const spec = BUSINESS_SCOPES[type]?.list;
  if (!spec) {
    throw new Error(`未知业务类型: ${type}。可选: ${ALL_BASE_NAMES.join(", ")}`);
  }

  const { where, paramNames } = buildListWhere(spec, filters);
  paramNames.unshift("limit");

  const sqlText = [
    `SELECT DISTINCT TOP (@limit)${spec.select}`,
    spec.from,
    where.join("\n"),
    `ORDER BY scheduling_time DESC`,
  ].join("\n");

  return { sql: sqlText, paramNames } as BuiltListQuery;
}

/**
 * 为指定业务类型构建统计查询：返回匹配订单的「总数」与「已完成数」（不做 TOP 截断）。
 * 与 buildOrderListQuery 共用同一套 WHERE 条件，保证统计口径一致。
 */
export function buildOrderListCountQuery(
  type: BaseName,
  filters: OrderListFilters,
): BuiltListQuery {
  const spec = BUSINESS_SCOPES[type]?.list;
  if (!spec) {
    throw new Error(`未知业务类型: ${type}。可选: ${ALL_BASE_NAMES.join(", ")}`);
  }

  const { where, paramNames } = buildListWhere(spec, filters);
  const sqlText = [
    `SELECT`,
    `    COUNT(DISTINCT ${spec.orderNoCol}) AS total,`,
    `    COUNT(DISTINCT ${spec.completedExpr}) AS completed`,
    spec.from,
    where.join("\n"),
  ].join("\n");

  return { sql: sqlText, paramNames } as BuiltListQuery;
}

/**
 * 为指定业务类型构建「按产品线分组」的统计查询（不截断，GROUP BY 产品线）。
 * 解决「各产品线分别多少单」的精确统计——此前只有按业务类型的 by_type 总数，
 * 产品线维度只能靠被 TOP 截断的明细行估算，导致统计不准。
 *
 * 各类型已有 lineCol 定义（见 ORDER_LIST_SPECS）。产品线为空值（NULL/空串）归入
 * 别名 "(未指定产品线)"，避免分组里空值行对不上号。
 */
export function buildOrderListLineCountQuery(
  type: BaseName,
  filters: OrderListFilters,
): BuiltListQuery {
  const spec = BUSINESS_SCOPES[type]?.list;
  if (!spec) {
    throw new Error(`未知业务类型: ${type}。可选: ${ALL_BASE_NAMES.join(", ")}`);
  }

  const { where, paramNames } = buildListWhere(spec, filters);
  const lineCol = `COALESCE(NULLIF(${spec.lineCol}, ''), N'(未指定产品线)')`;
  const sqlText = [
    `SELECT`,
    `    ${lineCol} AS product_line,`,
    `    COUNT(DISTINCT ${spec.orderNoCol}) AS total,`,
    `    COUNT(DISTINCT ${spec.completedExpr}) AS completed`,
    spec.from,
    where.join("\n"),
    `GROUP BY ${lineCol}`,
    `ORDER BY total DESC`,
  ].join("\n");

  return { sql: sqlText, paramNames } as BuiltListQuery;
}

export interface OrderListLineStat {
  product_line: string;
  total: number;
  completed: number;
}

export interface OrderListTypeResult {
  type: BaseName;
  /** 未发 SQL 的原因（如请求基地与类型隐含基地冲突） */
  skipped?: string;
  /** 匹配订单总数（真实统计，不受明细截断影响） */
  count: number;
  /** 已完成订单数（真实统计） */
  completed?: number;
  /** 明细行是否被 TOP 截断（count > limit） */
  truncated: boolean;
  rows: Record<string, unknown>[];
  /** 按产品线分组统计（不截断，GROUP BY 产品线；无产品线过滤时返回，用于精确回答各产品线单量） */
  by_line?: OrderListLineStat[];
  error?: string;
}

/** 异常标记判定：非空且非 0 即有异常（字段为字符串 '1' 或空） */
function isExceptionFlag(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  return s !== "" && s !== "0";
}

/**
 * 上海工艺实验料次聚合（纯函数，便于单测）。
 *
 * 一个订单可能有多个料次（order_count = 料次号，1/2/3…），每料次一行。
 * 整单完成判定：**以最后一个料次（料次号最大者）为准**——
 * 最后一次料次的最终班长完成即代表整单完成（业务规则）。
 *
 * 聚合结果每订单一行：其余字段取最后料次的值，异常取各料次并集，
 * 附 lot_total（料次总数）/ lot_completed（已完成料次数）。
 */
export function aggregateOrderLots(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byOrder = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = String(row.order_no ?? "");
    const lots = byOrder.get(key);
    if (lots) lots.push(row);
    else byOrder.set(key, [row]);
  }
  const out: Record<string, unknown>[] = [];
  for (const lots of byOrder.values()) {
    const lastLot = lots.reduce((a, b) =>
      Number(b.order_count ?? 0) > Number(a.order_count ?? 0) ? b : a,
    );
    const lotCompleted = lots.filter((l) => l.status === "已完成").length;
    const exceptions = Array.from(
      new Set(lots.flatMap((l) => (Array.isArray(l.exceptions) ? (l.exceptions as string[]) : []))),
    );
    out.push({ ...lastLot, exceptions, lot_total: lots.length, lot_completed: lotCompleted });
  }
  return out;
}

async function queryOneTypeForList(
  type: BaseName,
  filters: OrderListFilters,
  limit: number,
): Promise<OrderListTypeResult> {
  const spec = BUSINESS_SCOPES[type]?.list;

  // 固定基地类型：请求基地与隐含基地不符 → 跳过（不发 SQL）
  if (
    filters.base &&
    spec.implicitBase &&
    !filters.base.includes(spec.implicitBase) &&
    !spec.implicitBase.includes(filters.base)
  ) {
    return {
      type,
      count: 0,
      truncated: false,
      rows: [],
      skipped: `请求基地「${filters.base}」与 ${type} 的隐含基地「${spec.implicitBase}」不符`,
    };
  }

  const { sql: sqlText, paramNames } = buildOrderListQuery(type, filters);
  const { sql: countSql, paramNames: countParams } = buildOrderListCountQuery(type, filters);
  const { sql: lineSql, paramNames: lineParams } = buildOrderListLineCountQuery(type, filters);
  const pool = await getPool();

  // 明细（TOP 截断）、按业务类型统计、按产品线统计（后两者均不截断）三路并行执行
  const request = pool.request();
  request.input("limit", sql.Int, limit);
  const countRequest = pool.request();
  const lineRequest = pool.request();
  for (const p of paramNames) {
    if (p === "limit") continue;
    const v = p === "tech" ? filters.technician
      : p === "base" ? filters.base
      : p === "grade" ? filters.grade
      : p === "line" ? filters.product_line
      : p === "since" ? filters.since
      : filters.until;
    request.input(p, sql.NVarChar, v);
  }
  for (const p of countParams) {
    const v = p === "tech" ? filters.technician
      : p === "base" ? filters.base
      : p === "grade" ? filters.grade
      : p === "line" ? filters.product_line
      : p === "since" ? filters.since
      : filters.until;
    countRequest.input(p, sql.NVarChar, v);
  }
  for (const p of lineParams) {
    const v = p === "tech" ? filters.technician
      : p === "base" ? filters.base
      : p === "grade" ? filters.grade
      : p === "line" ? filters.product_line
      : p === "since" ? filters.since
      : filters.until;
    lineRequest.input(p, sql.NVarChar, v);
  }

  const [result, countResult, lineResult] = await Promise.all([
    request.query(sqlText),
    countRequest.query(countSql),
    lineRequest.query(lineSql),
  ]);
  const rawRows = (result.recordset || []) as Record<string, unknown>[];
  const countRow = (countResult.recordset || [])[0] as { total?: number; completed?: number } | undefined;
  const totalCount = Number(countRow?.total) || 0;
  const completedCount = Number(countRow?.completed) || 0;
  const byLine: OrderListLineStat[] = ((lineResult.recordset || []) as Record<string, unknown>[]).map((r) => ({
    product_line: String(r.product_line ?? ""),
    total: Number(r.total) || 0,
    completed: Number(r.completed) || 0,
  }));

  const withMeta: Record<string, unknown>[] = rawRows.map((rawRow) => {
    const row = normalizeRowDates(rawRow);
    const exceptions: string[] = [];
    if (isExceptionFlag(row.extrusion_exception)) exceptions.push("挤出");
    if (isExceptionFlag(row.injection_strip_exception)) exceptions.push("注塑样条");
    if (isExceptionFlag(row.injection_color_plate_exception)) exceptions.push("注塑色板");
    return { ...row, type, exceptions };
  });

  let rows: Record<string, unknown>[];
  if (type === "上海工艺实验") {
    // 一单多料次：按订单聚合，整单完成以最后料次为准
    rows = aggregateOrderLots(withMeta);
  } else {
    // 按订单号去重：技术员表等 JOIN 可能对同一订单返回多行（DISTINCT 无法合并的差异行在此兜底）
    const seen = new Set<string>();
    rows = withMeta.filter((row) => {
      const orderNo = String(row.order_no ?? "");
      if (seen.has(orderNo)) return false;
      seen.add(orderNo);
      return true;
    });
  }

  return { type, count: totalCount, completed: completedCount, truncated: totalCount > limit, rows, by_line: byLine };
}

/**
 * 多业务类型并行列表查询。单类型失败不影响其他类型（catch 后记 error）。
 * 结果按传入的 types 顺序返回；total 为各类型命中行数之和。
 */
export async function queryOrdersList(
  filters: OrderListFilters & { types: BaseName[] },
): Promise<{ results: OrderListTypeResult[]; total: number }> {
  const limit = filters.limit ?? DEFAULT_LIST_LIMIT;
  const results = await Promise.all(
    filters.types.map((t) =>
      queryOneTypeForList(t, filters, limit).catch(
        (err): OrderListTypeResult => ({
          type: t,
          count: 0,
          truncated: false,
          rows: [],
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    ),
  );
  const total = results.reduce((s, r) => s + r.count, 0);
  return { results, total };
}
