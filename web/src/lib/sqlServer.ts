/**
 * SQL Server 数据服务 — 生产执行看板全量查询
 * 4 个数据源：中试广州、中试上海、小试、OA辅助单
 */

import sql from "mssql";

// ── 连接池 ──

let _pool: sql.ConnectionPool | null = null;
let _connecting: Promise<sql.ConnectionPool> | null = null;

function getConfig() {
  const cfg = {
    server: process.env.SQL_HOST || "",
    port: Number(process.env.SQL_PORT) || 1433,
    database: process.env.SQL_DB || "",
    user: process.env.SQL_USER || "",
    password: process.env.SQL_PASSWORD || "",
  };
  if (!cfg.server || !cfg.database) {
    throw new Error("SQL Server 配置缺失");
  }
  return cfg;
}

async function getPool(): Promise<sql.ConnectionPool> {
  if (_pool?.connected) return _pool;
  if (_connecting) return _connecting;

  const cfg = getConfig();
  _connecting = new sql.ConnectionPool({
    server: cfg.server, port: cfg.port, database: cfg.database,
    user: cfg.user, password: cfg.password,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 60_000 },
    pool: { max: 5, min: 0, idleTimeoutMillis: 120_000 },
  })
    .connect()
    .then((pool) => { _pool = pool; _connecting = null; pool.on("error", () => { _pool = null; }); return pool; })
    .catch((err) => { _connecting = null; throw err; });
  return _connecting;
}

// ── 类型 ──

export interface DashboardOrder {
  orderNo: string;
  dataSource: string;
  baseName: string;
  machine: string | null;
  orderCount: number;
  extrusionException: boolean;
  injectionStripException: boolean;
  injectionColorPlateException: boolean;
  createOrderTime: string | null;
  schedulingTime: string | null;
  colorPowderMeasureTime: string | null;
  mixingTime: string | null;
  extrusionTime: string | null;
  injectionColorPlateTime: string | null;
  injectionStripTime: string | null;
  finalCompleteTime: string | null;
  creator: string | null;
  schedulingPerson: string | null;
  colorPowderMeasurer: string | null;
  mixingPerson: string | null;
  extrusionPerson: string | null;
  injectionColorPlatePerson: string | null;
  injectionStripPerson: string | null;
  finalMonitor: string | null;
}

// ── 异常值解析（字段为字符串 '1' 或空 ''） ──

function isEx(val: unknown): boolean {
  return val === "1" || val === 1 || val === true;
}

function strOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  // SQL Server 默认日期 1900-01-01，视为无效
  if (s.startsWith("1900-") || s.startsWith("1899-")) return null;
  return s;
}

// ── 基地名映射 ──

function mapBaseName(baseField: string | null, dataSource: string): string {
  if (dataSource === "广州中试") return "广州基地";
  if (dataSource === "上海中试") return "上海基地";
  if (baseField) {
    const b = baseField.trim();
    if (b.includes("广州")) return "广州基地";
    if (b.includes("上海")) return "上海基地";
    if (b.includes("天津")) return "天津基地";
    if (b.includes("武汉")) return "武汉基地";
    if (b.includes("成都")) return "成都基地";
    return `${b}基地`;
  }
  return "未知基地";
}

// ── SQL 模板（无 ORDER BY，避免 SELECT DISTINCT 冲突） ──

const SQL_GZ = `
SELECT
    t.f52977  AS order_no,
    t.f52974  AS machine,
    t.f52978  AS order_count,
    t.f140429 AS extrusion_exception,
    t.f140425 AS injection_strip_exception,
    t.f140430 AS injection_color_plate_exception,
    p.开单人员        AS creator,
    CONVERT(varchar, t.f52994, 120)  AS create_order_time,
    p.色粉计量人员    AS color_powder_measurer,
    CONVERT(varchar, t.f53049, 120)  AS color_powder_measure_time,
    p.混料人员        AS mixing_person,
    CONVERT(varchar, t.f53051, 120)  AS mixing_time,
    p.挤出人员        AS extrusion_person,
    CONVERT(varchar, t.f53053, 120)  AS extrusion_time,
    p.注塑色板人员    AS injection_color_plate_person,
    CONVERT(varchar, t.f53055, 120)  AS injection_color_plate_time,
    p.注塑样条人员    AS injection_strip_person,
    CONVERT(varchar, t2.f79509, 120) AS injection_strip_time,
    p.最终班长        AS final_monitor,
    CONVERT(varchar, t.f53419, 120)  AS final_complete_time,
    CONVERT(varchar, t.f140799, 120) AS scheduling_time,
    p.排产完成人员    AS scheduling_person
FROM tabdiytable3393 t
LEFT JOIN tabdiytable3946 t2 ON t.f52977 = t2.f68150
CROSS JOIN (
    SELECT '王武龙' AS 开单人员, '丘文彬' AS 色粉计量人员,
           '邹华明' AS 混料人员, '邹华明' AS 挤出人员,
           '刘富贵' AS 注塑色板人员, '杨文超' AS 注塑样条人员,
           '邹华明' AS 最终班长, '杨东东' AS 排产完成人员
) p
WHERE t.f52994 > @since`;

// 上海中试：主表查询（不走 JOIN，避免超时；取最近 5000 条）
const SQL_SH_BASE = `
SELECT TOP 5000
    f96425 AS order_no,
    f96435 AS machine,
    f96426 AS order_count
FROM tabdiytable5724
WHERE f96425 IS NOT NULL`;

// 上海中试：异常统计（轻量 JOIN）
const SQL_SH_EXCEPTIONS = `
SELECT
    t2.f96425 AS order_no,
    t4.f140720 AS extrusion_exception,
    t6.f140718 AS injection_strip_exception,
    t5.f140719 AS injection_color_plate_exception
FROM tabdiytable5724 t2
LEFT JOIN tabdiytable5699 t4 ON t2.f96425 = t4.f95904 AND t2.f96426 = t4.f95916
LEFT JOIN tabdiytable5711 t6 ON t2.f96425 = t6.f96280
LEFT JOIN tabdiytable5707 t5 ON t2.f96425 = t5.f96198 AND t2.f96426 = t5.f96214
WHERE t2.f96425 IS NOT NULL`;

const SQL_XS = `
SELECT
    t.f102935 AS order_no,
    t.f102925 AS base,
    t.f102932 AS machine,
    t.f102936 AS order_count,
    t.f140432 AS extrusion_exception,
    t.f140431 AS injection_strip_exception,
    0 AS injection_color_plate_exception,
    '' AS creator,
    CONVERT(varchar, t.f102950, 120) AS create_order_time,
    '' AS color_powder_measurer,
    CONVERT(varchar, t.f102957, 120) AS color_powder_measure_time,
    p.混料人员        AS mixing_person,
    CONVERT(varchar, t.f102959, 120) AS mixing_time,
    p.挤出人员        AS extrusion_person,
    CONVERT(varchar, t.f102961, 120) AS extrusion_time,
    '' AS injection_color_plate_person,
    NULL AS injection_color_plate_time,
    p.注塑样条人员    AS injection_strip_person,
    CONVERT(varchar, t.f102994, 120) AS injection_strip_time,
    p.最终班长        AS final_monitor,
    CONVERT(varchar, t.f102967, 120) AS final_complete_time,
    CONVERT(varchar, t.f140798, 120) AS scheduling_time,
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
WHERE t.f102959 > @since`;

const SQL_OA = `
SELECT
    t.f138799 AS order_no,
    t.f138800 AS machine,
    t.f138820 AS order_count,
    t2.f138796 AS base,
    0 AS extrusion_exception,
    t.f140730 AS injection_strip_exception,
    0 AS injection_color_plate_exception,
    '' AS creator,
    NULL AS create_order_time,
    '' AS color_powder_measurer,
    NULL AS color_powder_measure_time,
    '' AS mixing_person,
    NULL AS mixing_time,
    '' AS extrusion_person,
    NULL AS extrusion_time,
    '' AS injection_color_plate_person,
    NULL AS injection_color_plate_time,
    p.注塑人员        AS injection_strip_person,
    CONVERT(varchar, t.f138978, 120) AS injection_strip_time,
    p.注塑人员        AS final_monitor,
    NULL AS final_complete_time,
    CONVERT(varchar, t.f138823, 120) AS scheduling_time,
    p.排产人员        AS scheduling_person
FROM tabdiytable8460 t
LEFT JOIN tabdiytable8459 t2 ON t.ID = t2.ID
LEFT JOIN (
    SELECT f136277,
        MAX(CASE WHEN f53444 = '注塑' THEN f53443 END) AS 注塑人员,
        MAX(CASE WHEN f53444 = '排产' THEN f53443 END) AS 排产人员
    FROM (
        SELECT f136277, f53444, f53443,
               ROW_NUMBER() OVER (PARTITION BY f136277, f53444 ORDER BY ID DESC) AS rn
        FROM tabdiytable3439
        WHERE f53444 IN ('注塑', '排产')
    ) ranked
    WHERE rn = 1
    GROUP BY f136277
) p ON p.f136277 = t2.f138796
WHERE t.f138823 > @since`;

// ── 查询函数 ──

export async function fetchAllDashboardOrders(sinceDays: number = 90): Promise<DashboardOrder[]> {
  const pool = await getPool();
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString().slice(0, 10);

  const queries: { sql: string; source: string; needsSince?: boolean }[] = [
    { sql: SQL_GZ, source: "广州中试", needsSince: true },
    { sql: SQL_XS, source: "小试", needsSince: true },
    { sql: SQL_OA, source: "OA辅助单", needsSince: true },
  ];

  const allOrders: DashboardOrder[] = [];

  // Helper to parse rows into orders
  function parseRows(rows: Record<string, unknown>[], source: string): DashboardOrder[] {
    return rows.map((row) => ({
      orderNo: String(row.order_no || ""),
      dataSource: source,
      baseName: mapBaseName(row.base ? String(row.base) : null, source),
      machine: strOrNull(row.machine),
      orderCount: Number(row.order_count) || 1,
      extrusionException: isEx(row.extrusion_exception),
      injectionStripException: isEx(row.injection_strip_exception),
      injectionColorPlateException: isEx(row.injection_color_plate_exception),
      createOrderTime: strOrNull(row.create_order_time),
      schedulingTime: strOrNull(row.scheduling_time),
      colorPowderMeasureTime: strOrNull(row.color_powder_measure_time),
      mixingTime: strOrNull(row.mixing_time),
      extrusionTime: strOrNull(row.extrusion_time),
      injectionColorPlateTime: strOrNull(row.injection_color_plate_time),
      injectionStripTime: strOrNull(row.injection_strip_time),
      finalCompleteTime: strOrNull(row.final_complete_time),
      creator: strOrNull(row.creator),
      schedulingPerson: strOrNull(row.scheduling_person),
      colorPowderMeasurer: strOrNull(row.color_powder_measurer),
      mixingPerson: strOrNull(row.mixing_person),
      extrusionPerson: strOrNull(row.extrusion_person),
      injectionColorPlatePerson: strOrNull(row.injection_color_plate_person),
      injectionStripPerson: strOrNull(row.injection_strip_person),
      finalMonitor: strOrNull(row.final_monitor),
    }));
  }

  // Standard queries with @since parameter
  for (const { sql: sqlText, source, needsSince } of queries) {
    try {
      const req = pool.request();
      if (needsSince) req.input("since", sql.NVarChar, sinceStr);
      const result = await req.query(sqlText);
      const rows = result.recordset || [];
      allOrders.push(...parseRows(rows, source));
      console.log(`[sqlServer] ${source}: ${rows.length} rows`);
    } catch (err) {
      console.error(`[sqlServer] ${source} query failed:`, err instanceof Error ? err.message : err);
    }
  }

  // 上海中试：只查基础订单（JOIN 太慢，待 SQL 优化后补异常和工序数据）
  try {
    const shBase = await pool.request().query(SQL_SH_BASE);
    const shOrders = parseRows(shBase.recordset || [], "上海中试");
    allOrders.push(...shOrders);
    console.log(`[sqlServer] 上海中试: ${shOrders.length} rows (base only)`);
  } catch (err) {
    console.error(`[sqlServer] 上海中试 query failed:`, err instanceof Error ? err.message : err);
  }

  return allOrders;
}
