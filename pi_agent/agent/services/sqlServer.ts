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
    .then((pool) => {
      _pool = pool;
      _connecting = null;
      pool.on("error", (err) => {
        console.error("[sqlServer] pool error:", err);
        _pool = null;
      });
      return pool;
    })
    .catch((err) => {
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

export type BaseName = "中试广州" | "小试" | "中试上海" | "中试天津";

export const ALL_BASE_NAMES: BaseName[] = ["中试广州", "小试", "中试上海", "中试天津"];

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
    t.f102932 AS machine,
    t.f102936 AS order_count,
    t.f140432 AS extrusion_exception,
    t.f140431 AS injection_strip_exception,
    p.开单人员        AS creator,
    t.f102950 AS create_order_time,
    p.色粉计量人员    AS color_powder_measurer,
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
CROSS JOIN (
    SELECT
        '' AS 开单人员,
        '' AS 色粉计量人员,
        MAX(CASE WHEN f53444 = '混料'     THEN f53443 END) AS 混料人员,
        MAX(CASE WHEN f53444 = '挤出'     THEN f53443 END) AS 挤出人员,
        MAX(CASE WHEN f53444 = '注塑'     THEN f53443 END) AS 注塑样条人员,
        MAX(CASE WHEN f53444 = '最终班长' THEN f53443 END) AS 最终班长,
        MAX(CASE WHEN f53444 = '排产'     THEN f53443 END) AS 排产完成人员
    FROM tabdiytable3439
    WHERE ID = '342019838'
      AND f136277 = @base
      AND f53444 IN ('混料', '挤出', '注塑', '最终班长', '排产')
) p
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

// 第 4 个 SQL：用户未明确标注基地名，暂命名为"中试天津"，可在 ALL_BASE_NAMES 中改名
const SQL_ZHONGSHI_TIANJIN = `
SELECT DISTINCT
    t.f138799 AS order_no,
    t.f138800 AS machine,
    t.f138820 AS order_count,
    t.f140730 AS injection_strip_exception,
    t.f138823 AS scheduling_time,
    p.排产完成人员    AS scheduling_person,
    p.最终班长        AS injection_strip_person,
    t.f138978 AS injection_strip_time
FROM tabdiytable8460 t
CROSS JOIN (
    SELECT
        MAX(CASE WHEN f53444 = '注塑' THEN f53443 END) AS 排产完成人员,
        MAX(CASE WHEN f53444 = '注塑' THEN f53443 END) AS 最终班长
    FROM tabdiytable3439
    WHERE ID = '342019838'
      AND f136277 = @base
      AND f53444 IN ('注塑')
) p
WHERE t.f138799 = @orderNo`;

const SQL_TEMPLATES: Record<BaseName, string> = {
  "中试广州": SQL_ZHONGSHI_GUANGZHOU,
  "小试":     SQL_XIAOSHI,
  "中试上海": SQL_ZHONGSHI_SHANGHAI,
  "中试天津": SQL_ZHONGSHI_TIANJIN,
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
  // 仅 小试 / 中试天津 的 SQL 用到 @base
  if (base === "小试" || base === "中试天津") {
    request.input("base", sql.NVarChar, base);
  }

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
