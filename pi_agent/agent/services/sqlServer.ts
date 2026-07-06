/**
 * SQL Server Service
 *
 * 连接中试生产管理 SQL Server，提供订单进度真实查询。
 *
 * - 单例连接池（首次调用懒加载）
 * - 4 个基地对应 4 套 SQL 模板
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

// ============================================
// 基地标识
// ============================================

export type BaseName = "中试广州" | "小试" | "中试上海" | "OA辅助单";

export const ALL_BASE_NAMES: BaseName[] = ["中试广州", "小试", "中试上海", "OA辅助单"];

// ============================================
// SQL 模板（每个基地一套）
// ============================================

const SQL_ZHONGSHI_GUANGZHOU = `
SELECT DISTINCT
    t.f52977  AS order_no,
    t.f52974  AS machine,
    t.f52978  AS order_count,
    t.f140429 AS extrusion_exception,
    t.f140425 AS injection_strip_exception,
    t.f140430 AS injection_color_plate_exception,
    p.开单人员        AS creator,
    t.f52994  AS create_order_time,
    p.色粉计量人员    AS color_powder_measurer,
    t.f53049  AS color_powder_measure_time,
    p.混料人员        AS mixing_person,
    t.f53051  AS mixing_time,
    p.挤出人员        AS extrusion_person,
    t.f53053  AS extrusion_time,
    p.注塑色板人员    AS injection_color_plate_person,
    t.f53055  AS injection_color_plate_time,
    p.注塑样条人员    AS injection_strip_person,
    t2.f79509 AS injection_strip_time,
    p.最终班长        AS final_monitor,
    t.f53419  AS final_complete_time,
    t.f140799 AS scheduling_time,
    p.排产完成人员    AS scheduling_person
FROM tabdiytable3393 t
LEFT JOIN tabdiytable3946 t2 ON t.f52977 = t2.f68150
CROSS JOIN (
    SELECT
        '王武龙' AS 开单人员,
        '丘文彬' AS 色粉计量人员,
        '邹华明' AS 混料人员,
        '邹华明' AS 挤出人员,
        '刘富贵' AS 注塑色板人员,
        '杨文超' AS 注塑样条人员,
        '邹华明' AS 最终班长,
        '杨东东' AS 排产完成人员
) p
WHERE t.f52977 = @orderNo`;

const SQL_XIAOSHI = `
SELECT DISTINCT
    t.f102935 AS order_no,
    t.f102925 AS base,
    t.f102932 AS machine,
    t.f102936 AS order_count,
    t.f140432 AS extrusion_exception,
    t.f140431 AS injection_strip_exception,
    '' AS creator,
    t.f102950 AS create_order_time,
    '' AS color_powder_measurer,
    t.f102957 AS color_powder_measure_time,
    p.混料人员        AS mixing_person,
    t.f102959 AS mixing_time,
    p.挤出人员        AS extrusion_person,
    t.f102961 AS extrusion_time,
    p.注塑样条人员    AS injection_strip_person,
    t.f102994 AS injection_strip_time,
    p.最终班长        AS final_monitor,
    t.f102967 AS final_complete_time,
    t.f140798 AS scheduling_time,
    p.排产完成人员    AS scheduling_person
FROM tabdiytable5992 t
LEFT JOIN (
    SELECT f136277,
        MAX(CASE WHEN f53444 = '混料'     THEN f53443 END) AS 混料人员,
        MAX(CASE WHEN f53444 = '挤出'     THEN f53443 END) AS 挤出人员,
        MAX(CASE WHEN f53444 = '注塑'     THEN f53443 END) AS 注塑样条人员,
        MAX(CASE WHEN f53444 = '最终班长' THEN f53443 END) AS 最终班长,
        MAX(CASE WHEN f53444 = '排产'     THEN f53443 END) AS 排产完成人员
    FROM (
        SELECT f136277, f53444, f53443,
               ROW_NUMBER() OVER (PARTITION BY f136277, f53444 ORDER BY ID DESC) AS rn
        FROM tabdiytable3439
        WHERE f53444 IN ('混料', '挤出', '注塑', '最终班长', '排产')
    ) ranked
    WHERE rn = 1
    GROUP BY f136277
) p ON p.f136277 = t.f102925
WHERE t.f102935 = @orderNo`;

const SQL_ZHONGSHI_SHANGHAI = `
SELECT DISTINCT
    t2.f96425 AS order_no,
    t2.f96435 AS machine,
    t2.f96426 AS order_count,
    t4.f140720 AS extrusion_exception,
    t6.f140718 AS injection_strip_exception,
    t5.f140719 AS injection_color_plate_exception,
    p.色粉计量人员    AS color_powder_measurer,
    t2.f96428 AS color_powder_measure_time,
    p.混料人员        AS mixing_person,
    t3.f95900 AS mixing_time,
    p.挤出人员        AS extrusion_person,
    t4.f95913 AS extrusion_time,
    p.注塑色板人员    AS injection_color_plate_person,
    t5.f96212 AS injection_color_plate_time,
    p.注塑样条人员    AS injection_strip_person,
    t6.f96290 AS injection_strip_time,
    p.最终班长        AS final_monitor,
    t7.f94880 AS final_complete_time,
    t8.f140800 AS scheduling_time,
    p.排产完成人员    AS scheduling_person
FROM tabdiytable5724 t2
LEFT JOIN tabdiytable5698 t3 ON t2.f96425 = t3.f95892  AND t2.f96426 = t3.f95902
LEFT JOIN tabdiytable5699 t4 ON t2.f96425 = t4.f95904  AND t2.f96426 = t4.f95916
LEFT JOIN tabdiytable5707 t5 ON t2.f96425 = t5.f96198  AND t2.f96426 = t5.f96214
LEFT JOIN tabdiytable5711 t6 ON t2.f96425 = t6.f96280
LEFT JOIN tabdiytable5625 t7 ON t2.f96425 = t7.f94863  AND t2.f96426 = t7.f94872
LEFT JOIN tabdiytable5690 t8 ON t2.f96425 = t8.f95720
CROSS JOIN (
    SELECT
        '袁刚'   AS 色粉计量人员,
        '彭江苇' AS 混料人员,
        '彭江苇' AS 挤出人员,
        '杨建洲' AS 注塑色板人员,
        '杨建洲' AS 注塑样条人员,
        '彭江苇' AS 最终班长,
        '彭江苇' AS 排产完成人员
) p
WHERE t2.f96425 = @orderNo`;

// OA辅助单（全集团）：跨基地范围，仅注塑工序，字段较少
const SQL_OA_ASSIST = `
SELECT DISTINCT
    t.f138799 AS order_no,
    t.f138800 AS machine,
    t.f138820 AS order_count,
    t2.f138796 AS base,
    t.f140730 AS injection_strip_exception,
    t.f138823 AS scheduling_time,
    p.注塑人员        AS scheduling_person,
    p.注塑人员        AS injection_strip_person,
    t.f138978 AS injection_strip_time
FROM tabdiytable8460 t
LEFT JOIN tabdiytable8459 t2 ON t.ID = t2.ID
LEFT JOIN (
    SELECT f136277,
        MAX(CASE WHEN f53444 = '注塑' THEN f53443 END) AS 注塑人员
    FROM (
        SELECT f136277, f53444, f53443,
               ROW_NUMBER() OVER (PARTITION BY f136277, f53444 ORDER BY ID DESC) AS rn
        FROM tabdiytable3439
        WHERE f53444 IN ('注塑', '排产')
    ) ranked
    WHERE rn = 1
    GROUP BY f136277
) p ON p.f136277 = t2.f138796
WHERE t.f138799 = @orderNo`;

const SQL_TEMPLATES: Record<BaseName, string> = {
  "中试广州": SQL_ZHONGSHI_GUANGZHOU,
  "小试":     SQL_XIAOSHI,
  "中试上海": SQL_ZHONGSHI_SHANGHAI,
  "OA辅助单": SQL_OA_ASSIST,
};

// ============================================
// 查询函数
// ============================================

export interface OrderProgressResult {
  base: BaseName;
  order_no: string;
  rows: Record<string, unknown>[];
  found: boolean;
}

/**
 * 查询指定基地下指定订单的进度。
 *
 * @throws Error 当 base 不在白名单 / SQL 配置缺失 / 连接失败 / 查询失败时
 */
export async function queryOrderProgress(
  orderNo: string,
  base: BaseName,
): Promise<OrderProgressResult> {
  const sqlText = SQL_TEMPLATES[base];
  if (!sqlText) {
    throw new Error(`未知基地: ${base}。可选: ${ALL_BASE_NAMES.join(", ")}`);
  }

  const pool = await getPool();
  const request = pool.request();
  request.input("orderNo", sql.NVarChar, orderNo);
  // 4 套模板均只用到 @orderNo：
  //   中试广州 / 中试上海 使用硬编码人员名；小试 / OA辅助单 为全集团范围，不绑定 base

  const result = await request.query(sqlText);
  const rows = (result.recordset || []) as Record<string, unknown>[];
  return {
    base,
    order_no: orderNo,
    rows,
    found: rows.length > 0,
  };
}

/**
 * 批量查询多个基地（并行发起，互不依赖）
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
        SUM(CASE WHEN f102967 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN f102967 > '1900-01-02' THEN 1 ELSE 0 END) as completed
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
