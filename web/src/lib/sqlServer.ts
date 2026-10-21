/**
 * SQL Server 数据服务 — 生产执行看板全量查询
 * 5 个数据源：广州工艺实验、广州送样&小订单、上海工艺实验、小试、OA辅助单
 * （中试上海暂时下线，后续如需恢复见 git 历史）
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
  technician: string | null;
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

// 按订单号去重（技术员表等 JOIN 可能对同一订单返回多行；DISTINCT 无法合并的差异行在此兜底，保留首行）
function dedupeByOrderNo(orders: DashboardOrder[]): DashboardOrder[] {
  const seen = new Set<string>();
  return orders.filter((o) => {
    if (seen.has(o.orderNo)) return false;
    seen.add(o.orderNo);
    return true;
  });
}

// 上海工艺实验料次聚合：一个订单可能有多个料次（order_count = 料次号，1/2/3…），每料次一行。
// 整单完成判定以最后一个料次（料次号最大者）为准——最后一次料次的最终班长完成即代表整单完成（业务规则），
// 因此字段取最后料次的值（finalCompleteTime 即最后料次的完成时间，isCompleted 逻辑自然满足该规则），
// 异常取各料次并集，orderCount 改为料次数。
function aggregateShanghaiOrders(orders: DashboardOrder[]): DashboardOrder[] {
  const byOrder = new Map<string, DashboardOrder[]>();
  for (const o of orders) {
    const lots = byOrder.get(o.orderNo);
    if (lots) lots.push(o);
    else byOrder.set(o.orderNo, [o]);
  }
  const out: DashboardOrder[] = [];
  for (const lots of byOrder.values()) {
    const lastLot = lots.reduce((a, b) => (b.orderCount > a.orderCount ? b : a));
    out.push({
      ...lastLot,
      orderCount: lots.length,
      extrusionException: lots.some((o) => o.extrusionException),
      injectionStripException: lots.some((o) => o.injectionStripException),
      injectionColorPlateException: lots.some((o) => o.injectionColorPlateException),
    });
  }
  return out;
}

// ── 基地名映射 ──

function mapBaseName(baseField: string | null, dataSource: string): string {
  if (dataSource === "广州中试") return "广州基地";           // 旧数据源名（兼容 seed/历史数据）
  if (dataSource === "广州工艺实验") return "广州基地";
  if (dataSource === "广州送样&小订单") return "广州基地";
  if (dataSource === "上海中试") return "上海基地";           // 旧数据源名（兼容 seed/历史数据）
  if (dataSource === "上海工艺实验") return "上海基地";
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

// 广州两个业务类型自 2026-04-01 起按订单号是否含 EX 拆分（之前统称广州中试）
const GZ_SPLIT_START = "2026-04-01";

// 广州工艺实验：订单号含 EX
// DISTINCT 必要：tabdiytable7367（技术员）对同一订单可能有多行，JOIN 会复制订单行
const SQL_GZ_EX = `
SELECT DISTINCT
    t.f52977  AS order_no,
    t3.f126815 AS technician,
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
LEFT JOIN tabdiytable7367 t3 ON t.f52977 = t3.f126876
CROSS JOIN (
    SELECT '王武龙' AS 开单人员, '冉海淘/贺建平' AS 色粉计量人员,
           '邹华明' AS 混料人员, '邹华明' AS 挤出人员,
           '刘富贵' AS 注塑色板人员, '杨文超' AS 注塑样条人员,
           '邹华明' AS 最终班长, '杨东东' AS 排产完成人员
) p
WHERE t.f52994 > @since AND t.f52994 > '${GZ_SPLIT_START}' AND t.f52977 LIKE '%EX%'`;

// 广州送样&小订单：订单号不含 EX
const SQL_GZ_NONEX = `
SELECT DISTINCT
    t.f52977  AS order_no,
    t3.f126815 AS technician,
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
LEFT JOIN tabdiytable7367 t3 ON t.f52977 = t3.f126876
CROSS JOIN (
    SELECT '王武龙' AS 开单人员, '冉海淘/贺建平' AS 色粉计量人员,
           '邹华明' AS 混料人员, '邹华明' AS 挤出人员,
           '刘富贵' AS 注塑色板人员, '杨文超' AS 注塑样条人员,
           '邹华明' AS 最终班长, '杨东东' AS 排产完成人员
) p
WHERE t.f52994 > @since AND t.f52994 > '${GZ_SPLIT_START}' AND t.f52977 NOT LIKE '%EX%'`;

// 上海工艺实验：订单号以 EX 开头。完整 JOIN 查询（EX 订单量少，可控）。
// 注意：技术员记录在「技术配方备注」(t8.f95728) 里，看板不做解析。
// 时间窗口：头表色粉计量时间 OR 排产时间（与 agent 数据层同口径，只查最近窗口内活跃订单，
// 同时显著减少 5 表 JOIN 的行数）
const SQL_SH_EX = `
SELECT DISTINCT
    t2.f96425 AS order_no,
    t2.f96435 AS machine,
    t2.f96426 AS order_count,
    t4.f140720 AS extrusion_exception,
    t6.f140718 AS injection_strip_exception,
    t5.f140719 AS injection_color_plate_exception,
    NULL AS create_order_time,
    p.色粉计量人员    AS color_powder_measurer,
    CONVERT(varchar, t2.f96428, 120) AS color_powder_measure_time,
    p.混料人员        AS mixing_person,
    CONVERT(varchar, t3.f95900, 120) AS mixing_time,
    p.挤出人员        AS extrusion_person,
    CONVERT(varchar, t4.f95913, 120) AS extrusion_time,
    p.注塑色板人员    AS injection_color_plate_person,
    CONVERT(varchar, t5.f96212, 120) AS injection_color_plate_time,
    p.注塑样条人员    AS injection_strip_person,
    CONVERT(varchar, t6.f96290, 120) AS injection_strip_time,
    p.最终班长        AS final_monitor,
    CONVERT(varchar, t7.f94880, 120) AS final_complete_time,
    CONVERT(varchar, t8.f140800, 120) AS scheduling_time,
    p.排产完成人员    AS scheduling_person
FROM tabdiytable5724 t2
LEFT JOIN tabdiytable5698 t3 ON t2.f96425 = t3.f95892 AND t2.f96426 = t3.f95902
LEFT JOIN tabdiytable5699 t4 ON t2.f96425 = t4.f95904 AND t2.f96426 = t4.f95916
LEFT JOIN tabdiytable5707 t5 ON t2.f96425 = t5.f96198 AND t2.f96426 = t5.f96214
LEFT JOIN tabdiytable5711 t6 ON t2.f96425 = t6.f96280
LEFT JOIN tabdiytable5625 t7 ON t2.f96425 = t7.f94863 AND t2.f96426 = t7.f94872
LEFT JOIN tabdiytable5690 t8 ON t2.f96425 = t8.f95720
CROSS JOIN (
    SELECT '袁刚' AS 色粉计量人员, '彭江苇' AS 混料人员,
           '彭江苇' AS 挤出人员, '杨建洲' AS 注塑色板人员,
           '杨建洲' AS 注塑样条人员, '彭江苇' AS 最终班长,
           '彭江苇' AS 排产完成人员
) p
WHERE t2.f96425 LIKE 'EX%' AND (t2.f96428 > @since OR t8.f140800 > @since)`;

// 小试：仅订单号含 EX 的订单，技术员来自 tabdiytable7367
const SQL_XS = `
SELECT DISTINCT
    t.f102935 AS order_no,
    t2.f126815 AS technician,
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
    CONVERT(varchar, t.f102963, 120) AS injection_strip_time,
    p.最终班长        AS final_monitor,
    CONVERT(varchar, t.f102963, 120) AS final_complete_time,
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
        WHERE f53444 IN ('混料', '挤出', '注塑', '最终班长', '排产') AND ID = '342019838'
    ) ranked
    WHERE rn = 1
    GROUP BY f136277
) p ON p.f136277 = t.f102925
LEFT JOIN tabdiytable7367 t2 ON t.f102935 = t2.f126876
WHERE t.f102959 > @since AND t.f102935 LIKE '%EX%'`;

// OA辅助单：技术员为辅助单自带字段 (f138815)
const SQL_OA = `
SELECT DISTINCT
    t.f138799 AS order_no,
    t.f138815 AS technician,
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
    { sql: SQL_GZ_EX, source: "广州工艺实验", needsSince: true },
    { sql: SQL_GZ_NONEX, source: "广州送样&小订单", needsSince: true },
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
      technician: strOrNull(row.technician),
    }));
  }

  // Standard queries with @since parameter
  for (const { sql: sqlText, source, needsSince } of queries) {
    try {
      const req = pool.request();
      if (needsSince) req.input("since", sql.NVarChar, sinceStr);
      const result = await req.query(sqlText);
      const rows = result.recordset || [];
      const parsed = dedupeByOrderNo(parseRows(rows, source));
      allOrders.push(...parsed);
      console.log(`[sqlServer] ${source}: ${rows.length} rows, ${parsed.length} orders`);
    } catch (err) {
      console.error(`[sqlServer] ${source} query failed:`, err instanceof Error ? err.message : err);
    }
  }

  // 上海工艺实验：EX 订单，完整 JOIN（订单量少；若变慢参考性能审计补索引）
  // 一单多料次 → 聚合到订单级（整单完成以最后料次为准）
  try {
    const shEx = await pool.request().input("since", sql.NVarChar, sinceStr).query(SQL_SH_EX);
    const shLots = parseRows(shEx.recordset || [], "上海工艺实验");
    const shExOrders = aggregateShanghaiOrders(shLots);
    allOrders.push(...shExOrders);
    console.log(`[sqlServer] 上海工艺实验: ${shLots.length} 料次 → ${shExOrders.length} orders`);
  } catch (err) {
    console.error(`[sqlServer] 上海工艺实验 query failed:`, err instanceof Error ? err.message : err);
  }

  return allOrders;
}
