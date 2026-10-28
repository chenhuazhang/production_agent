/**
 * BusinessScopes — 业务范围的唯一事实来源
 *
 * 一个业务范围需要同时被点查、列表、工序装饰、权限和多智能体分流使用。
 * 以前这些事实散在 sqlServer.ts 的八处并列表里，新增一个范围要改八遍。
 * 现在它们收在这个模块内：外部只看见 BusinessScope 和 BUSINESS_SCOPES，
 * 内部的窗口谓词、SQL 模板、工序表、完成信号、列表 spec 都是 implementation。
 *
 * 注意：SQL 文本是生产契约，改动必须同步 sqlServer.test.ts 与开放接口文档。
 */


// ============================================
// 业务类型标识
// ============================================

// 注：中试上海（非 EX 上海订单）暂时下线，后续如需恢复见 git 历史
export type BaseName =
  | "广州工艺实验"
  | "广州送样&小订单"
  | "小试"
  | "上海工艺实验"
  | "OA辅助单";

export const ALL_BASE_NAMES: BaseName[] = [
  "广州工艺实验",
  "广州送样&小订单",
  "小试",
  "上海工艺实验",
  "OA辅助单",
];
// ============================================
// 业务类型别名（自然语言问法 → 正式类型）
// ============================================

/** 键为归一化后的小写形式（中文不受影响，"OA辅助单" 归一为 "oa辅助单"） */
export const BUSINESS_TYPE_ALIASES: Record<string, BaseName[]> = {
  // 正式名 → 自身
  "广州工艺实验": ["广州工艺实验"],
  "广州送样&小订单": ["广州送样&小订单"],
  "小试": ["小试"],
  "上海工艺实验": ["上海工艺实验"],
  "oa辅助单": ["OA辅助单"],
  // 别名
  "研发实验": ["小试"],                       // 研发实验 = 小试（全集团）
  "工艺实验": ["广州工艺实验", "上海工艺实验"], // 工艺实验 = 广州 + 上海
  "注塑单": ["OA辅助单"],
  "研发辅助单": ["OA辅助单"],
  // 「实验单/实验」= 研发实验 + 工艺实验 + 研发辅助单（OA辅助单），
  // 业务口径要求把 OA 辅助单也算进实验单（用户问"下了多少实验单"时常被漏算）
  "实验单": ["广州工艺实验", "上海工艺实验", "小试", "OA辅助单"],
  "实验": ["广州工艺实验", "上海工艺实验", "小试", "OA辅助单"],
  // 「所有单/全部/下单」= 全部业务范围（用户笼统问"下了多少单"时不应漏任何一类）
  "所有单": ["广州工艺实验", "广州送样&小订单", "小试", "上海工艺实验", "OA辅助单"],
  "全部": ["广州工艺实验", "广州送样&小订单", "小试", "上海工艺实验", "OA辅助单"],
  "下单": ["广州工艺实验", "广州送样&小订单", "小试", "上海工艺实验", "OA辅助单"],
  // 常见简称
  "送样": ["广州送样&小订单"],
  "小订单": ["广州送样&小订单"],
};

/**
 * 把业务类型别名/正式名解析为 BaseName 列表。
 * - 空/未传 → 全部业务类型
 * - 未知输入抛错（错误信息附可用关键词清单）
 * - 结果按 ALL_BASE_NAMES 顺序去重
 */
export function resolveBusinessTypes(inputs?: string[]): BaseName[] {
  if (!inputs || inputs.length === 0) return [...ALL_BASE_NAMES];
  const resolved = new Set<BaseName>();
  const unknown: string[] = [];
  for (const raw of inputs) {
    const key = String(raw).trim().toLowerCase();
    const targets = BUSINESS_TYPE_ALIASES[key];
    if (!targets) {
      unknown.push(String(raw).trim());
      continue;
    }
    for (const t of targets) resolved.add(t);
  }
  if (unknown.length > 0) {
    throw new Error(
      `无法识别的业务类型: ${unknown.join(", ")}。可用关键词: ` +
        Object.keys(BUSINESS_TYPE_ALIASES).join(", "),
    );
  }
  return ALL_BASE_NAMES.filter((b) => resolved.has(b));
}
// ============================================
// SQL 模板（每个业务类型一套）
// ============================================

// ── 数据窗口：所有查询只查最近 3 个月内有工序活动的订单 ──
// 服务端 DATEADD(MONTH,-3,GETDATE()) 计算，不依赖客户端时钟/时区。
// 每类用「多个高填充率时间列 OR」而非单一排产时间——实测排产时间填充率很低
// （广州仅约 6%），只按排产时间过滤会误伤大量近期活跃订单。
const WINDOW = "DATEADD(MONTH, -3, GETDATE())";
/** 广州两类：开单 / 色粉计量 / 混料 / 挤出 / 最终完成 / 排产 */
const WINDOW_GZ = `(t.f52994 >= ${WINDOW} OR t.f53049 >= ${WINDOW} OR t.f53051 >= ${WINDOW} OR t.f53053 >= ${WINDOW} OR t.f53419 >= ${WINDOW} OR t.f140799 >= ${WINDOW})`;
/** 小试：排产 / 混料 / 挤出 / 注塑完成（完成信号，原最终完成 f102967 已弃用） */
const WINDOW_XIAOSHI = `(t.f140798 >= ${WINDOW} OR t.f102959 >= ${WINDOW} OR t.f102961 >= ${WINDOW} OR t.f102963 >= ${WINDOW})`;
/** 上海工艺实验：头表色粉计量时间 OR 排产时间（均在已 JOIN 的表上，不增加 JOIN） */
const WINDOW_SH = `(t2.f96428 >= ${WINDOW} OR t8.f140800 >= ${WINDOW})`;
/** OA辅助单：排产 / 注塑样条 */
const WINDOW_OA = `(t.f138823 >= ${WINDOW} OR t.f138978 >= ${WINDOW})`;
// 广州工艺实验 / 广州送样&小订单：同一张主表、同一组列，只有订单号是否含 EX 不同
const GZ_DETAIL_BODY = `
SELECT DISTINCT
    t.f52977  AS order_no,
    t3.f126815 AS 技术员,
    t.f52966  AS 牌号,
    t3.f126825 AS 产品线,
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
LEFT JOIN tabdiytable7367 t3 ON t.f52977 = t3.f126876
CROSS JOIN (
    SELECT
        '王武龙' AS 开单人员,
        '冉海淘/贺建平' AS 色粉计量人员,
        '邹华明' AS 混料人员,
        '邹华明' AS 挤出人员,
        '刘富贵' AS 注塑色板人员,
        '杨文超' AS 注塑样条人员,
        '邹华明' AS 最终班长,
        '杨东东' AS 排产完成人员
) p`;

/** 生成广州两类共用的点查 SQL（@orderNo 绑定） */
function gzDetail(orderNoMatch: "LIKE" | "NOT LIKE"): string {
  return `${GZ_DETAIL_BODY}
WHERE t.f52977 = @orderNo AND t.f52977 ${orderNoMatch} '%EX%' AND ${WINDOW_GZ}`;
}


// 小试（全集团）：仅订单号含 EX 的订单，技术员来自 tabdiytable7367
const SQL_XIAOSHI = `
SELECT DISTINCT
    t.f102935 AS order_no,
    t2.f126815 AS 技术员,
    t.f102924 AS 牌号,
    t2.f126825 AS 产品线,
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
    t.f102962 AS 注塑人员姓名,
    t.f102963 AS 注塑完成时间,
    p.最终班长        AS final_monitor,
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
        WHERE f53444 IN ('混料', '挤出', '注塑', '最终班长', '排产') AND ID = '342019838'
    ) ranked
    WHERE rn = 1
    GROUP BY f136277
) p ON p.f136277 = t.f102925
LEFT JOIN tabdiytable7367 t2 ON t.f102935 = t2.f126876
WHERE t.f102935 = @orderNo AND t.f102935 LIKE '%EX%' AND ${WINDOW_XIAOSHI}`;

// 上海工艺实验：订单号以 EX 开头。
// 注意：技术员没有独立字段，记录在「技术配方备注」(t8.f95728) 里，需从备注文本中读取。
const SQL_SH_PROCESS_EXPERIMENT = `
SELECT DISTINCT
    t2.f96425 AS order_no,
    t8.f95728 AS 技术配方备注,
    t8.f95721 AS 牌号,
    t8.f95737 AS 产品线,
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
WHERE t2.f96425 = @orderNo AND t2.f96425 LIKE 'EX%' AND ${WINDOW_SH}`;

// OA辅助单（全集团）：跨基地范围，仅注塑工序，字段较少；技术员为辅助单自带字段
const SQL_OA_ASSIST = `
SELECT DISTINCT
    t.f138799 AS order_no,
    t.f138815 AS 技术员,
    t.f138802 AS 牌号,
    t.f138801 AS 产品线,
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
WHERE t.f138799 = @orderNo AND ${WINDOW_OA}`;


// ── 工序语义装饰 ─────────────────────────────────────────
//
// 外部系统（Open API 对接方）按工序时间自行推断"当前节点"极易出错：
// 源 ERP 里 色粉计量时间 等列记录率极低（近 3 个月仅约 3.6%），若拿"第一个
// 未完成工序"当当前节点，几乎所有订单（含早已挤出/完成/交付的）都会显示停在
// 色粉称量。因此点查行直接补 status / current_stage / stages[]，由数据层按
// 业务规则算好，对接方展示即可，不需要（也不应该）再推断。

export interface StageInfo {
  node: string;
  /** 该工序负责人（未记录为 null） */
  person: string | null;
  /** 完成时间 "YYYY-MM-DD HH:mm"（未完成/未记录为 null） */
  time: string | null;
  /** 是否已完成：完成时间有效即视为完成 */
  done: boolean;
}

/** 各业务类型的「做工」工序列表（开单/排产视为订单已存在必然发生，不入流） */
/** 单个工序在结果行里的取数规则 */
export interface StageSpec {
  node: string;
  /** 结果行里存放完成时间的字段名（可能是中文字段） */
  time: string;
  /** 结果行里存放负责人的字段名 */
  person?: string;
}

const STAGE_SPECS: Record<BaseName, StageSpec[]> = {
  "广州工艺实验": [
    { node: "色粉计量", time: "color_powder_measure_time", person: "color_powder_measurer" },
    { node: "混料", time: "mixing_time", person: "mixing_person" },
    { node: "挤出", time: "extrusion_time", person: "extrusion_person" },
    { node: "注塑色板", time: "injection_color_plate_time", person: "injection_color_plate_person" },
    { node: "注塑样条", time: "injection_strip_time", person: "injection_strip_person" },
    { node: "最终班长", time: "final_complete_time", person: "final_monitor" },
  ],
  "广州送样&小订单": [
    { node: "色粉计量", time: "color_powder_measure_time", person: "color_powder_measurer" },
    { node: "混料", time: "mixing_time", person: "mixing_person" },
    { node: "挤出", time: "extrusion_time", person: "extrusion_person" },
    { node: "注塑色板", time: "injection_color_plate_time", person: "injection_color_plate_person" },
    { node: "注塑样条", time: "injection_strip_time", person: "injection_strip_person" },
    { node: "最终班长", time: "final_complete_time", person: "final_monitor" },
  ],
  "小试": [
    // 无注塑色板；完成信号 = 注塑完成时间（SKILL.md 约定）
    { node: "色粉计量", time: "color_powder_measure_time" },
    { node: "混料", time: "mixing_time", person: "mixing_person" },
    { node: "挤出", time: "extrusion_time", person: "extrusion_person" },
    { node: "注塑样条", time: "注塑完成时间", person: "注塑人员姓名" },
  ],
  "上海工艺实验": [
    // 一单多料次：每行（料次）单独装饰
    { node: "色粉计量", time: "color_powder_measure_time", person: "color_powder_measurer" },
    { node: "混料", time: "mixing_time", person: "mixing_person" },
    { node: "挤出", time: "extrusion_time", person: "extrusion_person" },
    { node: "注塑色板", time: "injection_color_plate_time", person: "injection_color_plate_person" },
    { node: "注塑样条", time: "injection_strip_time", person: "injection_strip_person" },
    { node: "最终班长", time: "final_complete_time", person: "final_monitor" },
  ],
  "OA辅助单": [
    { node: "注塑", time: "injection_strip_time", person: "injection_strip_person" },
  ],
};

/** 整单完成信号所在的字段（有值即已完成） */
const COMPLETE_KEY: Record<BaseName, string> = {
  "广州工艺实验": "final_complete_time",
  "广州送样&小订单": "final_complete_time",
  "小试": "注塑完成时间",
  "上海工艺实验": "final_complete_time",
  "OA辅助单": "injection_strip_time",
};
export interface OrderListSpec {
  /** 摘要 SELECT 列（5 类统一形状，缺失列以 NULL/空串占位） */
  select: string;
  /** FROM + 最小 JOIN */
  from: string;
  /** 业务类型判别式（订单号模式）；OA辅助单无 */
  pattern?: string;
  /** 技术员过滤列。remark 模式 = 技术员写在备注文本里（上海工艺实验） */
  techFilter: { col: string; mode: "column" | "remark" };
  /** 地理基地列（仅 小试 / OA辅助单） */
  baseCol?: string;
  /** 固定基地类型（广州两类 → 广州；上海工艺实验 → 上海） */
  implicitBase?: "广州" | "上海";
  /** 产品牌号列（5 类均有） */
  gradeCol: string;
  /** 产品线列（5 类均有） */
  lineCol: string;
  /** 排产时间列（过滤 + 排序） */
  schedCol: string;
  /**
   * 排产时间为空（1900 哨兵 / NULL，未排产）时 since/until 过滤回退到的备用时间列
   * （通常为开单时间；无独立开单时间列的类型用其他活动时间列）。
   * 排产时间填充率低（广州约 6%），只按排产时间过滤会把已开单未排产的活跃订单
   * 整批滤掉（典型症状：加了「近1个月」后工艺实验单查不到）。缺省则不回退。
   */
  timeFallbackCol?: string;
  /** 完成判定列（> '1900-01-02' 视为已完成；记录用，实际嵌在 select 的 CASE 里） */
  completeCol: string;
  /** 数据窗口谓词：最近 3 个月硬限制（恒加在 WHERE 里，调用方 since 更早也不放行） */
  windowPredicate: string;
  /** 订单号列（统计总数用 COUNT(DISTINCT ...)） */
  orderNoCol: string;
  /** 已完成订单表达式：订单完成时返回订单号、否则 NULL（统计已完成数用 COUNT(DISTINCT ...)） */
  completedExpr: string;
}

const ORDER_LIST_SPECS: Record<BaseName, OrderListSpec> = {
  "广州工艺实验": {
    select: `
    t.f52977  AS order_no,
    N'广州'   AS base,
    t.f52974  AS machine,
    t.f52978  AS order_count,
    t3.f126815 AS technician,
    CAST(NULL AS NVARCHAR(MAX)) AS tech_remark,
    t.f52966  AS grade,
    t3.f126825 AS product_line,
    t.f52994  AS create_order_time,
    t.f140799 AS scheduling_time,
    CASE WHEN t.f53419 > '1900-01-02' THEN N'已完成' ELSE N'生产中' END AS status,
    t.f140429 AS extrusion_exception,
    t.f140425 AS injection_strip_exception,
    t.f140430 AS injection_color_plate_exception`,
    from: `FROM tabdiytable3393 t
LEFT JOIN tabdiytable7367 t3 ON t.f52977 = t3.f126876`,
    pattern: "t.f52977 LIKE '%EX%'",
    techFilter: { col: "t3.f126815", mode: "column" },
    implicitBase: "广州",
    gradeCol: "t.f52966",
    lineCol: "t3.f126825",
    schedCol: "t.f140799",
    // 排产时间为空时回退到开单时间（广州工艺实验排产时间填充率很低）
    timeFallbackCol: "t.f52994",
    completeCol: "t.f53419",
    windowPredicate: WINDOW_GZ,
    orderNoCol: "t.f52977",
    completedExpr: `CASE WHEN t.f53419 > '1900-01-02' THEN t.f52977 END`,
  },
  "广州送样&小订单": {
    select: `
    t.f52977  AS order_no,
    N'广州'   AS base,
    t.f52974  AS machine,
    t.f52978  AS order_count,
    t3.f126815 AS technician,
    CAST(NULL AS NVARCHAR(MAX)) AS tech_remark,
    t.f52966  AS grade,
    t3.f126825 AS product_line,
    t.f52994  AS create_order_time,
    t.f140799 AS scheduling_time,
    CASE WHEN t.f53419 > '1900-01-02' THEN N'已完成' ELSE N'生产中' END AS status,
    t.f140429 AS extrusion_exception,
    t.f140425 AS injection_strip_exception,
    t.f140430 AS injection_color_plate_exception`,
    from: `FROM tabdiytable3393 t
LEFT JOIN tabdiytable7367 t3 ON t.f52977 = t3.f126876`,
    pattern: "t.f52977 NOT LIKE '%EX%'",
    techFilter: { col: "t3.f126815", mode: "column" },
    implicitBase: "广州",
    gradeCol: "t.f52966",
    lineCol: "t3.f126825",
    schedCol: "t.f140799",
    // 排产时间为空时回退到开单时间
    timeFallbackCol: "t.f52994",
    completeCol: "t.f53419",
    windowPredicate: WINDOW_GZ,
    orderNoCol: "t.f52977",
    completedExpr: `CASE WHEN t.f53419 > '1900-01-02' THEN t.f52977 END`,
  },
  "小试": {
    select: `
    t.f102935 AS order_no,
    t.f102925 AS base,
    t.f102932 AS machine,
    t.f102936 AS order_count,
    t2.f126815 AS technician,
    CAST(NULL AS NVARCHAR(MAX)) AS tech_remark,
    t.f102924 AS grade,
    t2.f126825 AS product_line,
    t.f102950 AS create_order_time,
    t.f140798 AS scheduling_time,
    CASE WHEN t.f102963 > '1900-01-02' THEN N'已完成' ELSE N'生产中' END AS status,
    t.f140432 AS extrusion_exception,
    t.f140431 AS injection_strip_exception,
    '' AS injection_color_plate_exception`,
    from: `FROM tabdiytable5992 t
LEFT JOIN tabdiytable7367 t2 ON t.f102935 = t2.f126876`,
    pattern: "t.f102935 LIKE '%EX%'",
    techFilter: { col: "t2.f126815", mode: "column" },
    baseCol: "t.f102925",
    gradeCol: "t.f102924",
    lineCol: "t2.f126825",
    schedCol: "t.f140798",
    // 排产时间为空时回退到开单时间（t.f102950）
    timeFallbackCol: "t.f102950",
    completeCol: "t.f102963",
    windowPredicate: WINDOW_XIAOSHI,
    orderNoCol: "t.f102935",
    completedExpr: `CASE WHEN t.f102963 > '1900-01-02' THEN t.f102935 END`,
  },
  // 一单多料次（order_count=料次号），查询结果由 aggregateOrderLots 聚合到订单级
  "上海工艺实验": {
    select: `
    t2.f96425 AS order_no,
    N'上海'   AS base,
    t2.f96435 AS machine,
    t2.f96426 AS order_count,
    CAST(NULL AS NVARCHAR(MAX)) AS technician,
    t8.f95728 AS tech_remark,
    t8.f95721 AS grade,
    t8.f95737 AS product_line,
    CAST(NULL AS DATETIME2) AS create_order_time,
    t8.f140800 AS scheduling_time,
    CASE WHEN t7.f94880 > '1900-01-02' THEN N'已完成' ELSE N'生产中' END AS status,
    t4.f140720 AS extrusion_exception,
    t6.f140718 AS injection_strip_exception,
    t5.f140719 AS injection_color_plate_exception`,
    // ml：每个订单的最大料次号（派生表）。供 completedExpr 引用，
    // 避免在 COUNT(DISTINCT CASE...) 里内嵌 SELECT MAX(...) 触发「聚合套聚合」错误
    from: `FROM tabdiytable5724 t2
LEFT JOIN (
    SELECT f96425, MAX(f96426) AS max_lot
    FROM tabdiytable5724
    GROUP BY f96425
) ml ON ml.f96425 = t2.f96425
LEFT JOIN tabdiytable5699 t4 ON t2.f96425 = t4.f95904  AND t2.f96426 = t4.f95916
LEFT JOIN tabdiytable5707 t5 ON t2.f96425 = t5.f96198  AND t2.f96426 = t5.f96214
LEFT JOIN tabdiytable5711 t6 ON t2.f96425 = t6.f96280
LEFT JOIN tabdiytable5625 t7 ON t2.f96425 = t7.f94863  AND t2.f96426 = t7.f94872
LEFT JOIN tabdiytable5690 t8 ON t2.f96425 = t8.f95720`,
    pattern: "t2.f96425 LIKE 'EX%'",
    techFilter: { col: "t8.f95728", mode: "remark" },
    implicitBase: "上海",
    gradeCol: "t8.f95721",
    lineCol: "t8.f95737",
    schedCol: "t8.f140800",
    // 上海无独立开单时间列；排产为空时回退到色粉计量时间（窗口备用活动列）
    timeFallbackCol: "t2.f96428",
    completeCol: "t7.f94880",
    windowPredicate: WINDOW_SH,
    orderNoCol: "t2.f96425",
    // 上海一单多料次：订单完成 = 料次号最大的料次已最终完成（与 aggregateOrderLots 规则一致）。
    // 最大料次号取自 from 里的派生表 ml（不能在此内嵌 SELECT MAX(...)，否则 COUNT(DISTINCT CASE...)
    // 会变成「聚合套聚合」，SQL Server 报 error 130）
    completedExpr:
      `CASE WHEN t7.f94880 > '1900-01-02' AND t2.f96426 = ml.max_lot THEN t2.f96425 END`,
  },
  "OA辅助单": {
    select: `
    t.f138799 AS order_no,
    t2.f138796 AS base,
    t.f138800 AS machine,
    t.f138820 AS order_count,
    t.f138815 AS technician,
    CAST(NULL AS NVARCHAR(MAX)) AS tech_remark,
    t.f138802 AS grade,
    t.f138801 AS product_line,
    CAST(NULL AS DATETIME2) AS create_order_time,
    t.f138823 AS scheduling_time,
    CASE WHEN t.f138978 > '1900-01-02' THEN N'已完成' ELSE N'生产中' END AS status,
    '' AS extrusion_exception,
    t.f140730 AS injection_strip_exception,
    '' AS injection_color_plate_exception`,
    from: `FROM tabdiytable8460 t
LEFT JOIN tabdiytable8459 t2 ON t.ID = t2.ID`,
    techFilter: { col: "t.f138815", mode: "column" },
    baseCol: "t2.f138796",
    gradeCol: "t.f138802",
    lineCol: "t.f138801",
    schedCol: "t.f138823",
    // OA 无独立开单时间列；排产为空时回退到注塑样条时间（窗口备用活动列）
    timeFallbackCol: "t.f138978",
    completeCol: "t.f138978",
    windowPredicate: WINDOW_OA,
    orderNoCol: "t.f138799",
    completedExpr: `CASE WHEN t.f138978 > '1900-01-02' THEN t.f138799 END`,
  },
};



// ============================================
// 业务范围注册表（模块的唯一出口）
// ============================================

export interface BusinessScope {
  /** 正式名，与 BaseName 一致 */
  name: BaseName;
  /** 点查 SQL，已绑定 @orderNo */
  detailSql: string;
  /** 「做工」工序序列（开单 / 排产不计入） */
  stages: StageSpec[];
  /** 整单完成信号字段 */
  completeKey: string;
  /** 列表查询规格 */
  list: OrderListSpec;
}

export const BUSINESS_SCOPES: Record<BaseName, BusinessScope> = {
  "广州工艺实验": {
    name: "广州工艺实验",
    detailSql: gzDetail("LIKE"),
    stages: STAGE_SPECS["广州工艺实验"],
    completeKey: COMPLETE_KEY["广州工艺实验"],
    list: ORDER_LIST_SPECS["广州工艺实验"],
  },
  "广州送样&小订单": {
    name: "广州送样&小订单",
    detailSql: gzDetail("NOT LIKE"),
    stages: STAGE_SPECS["广州送样&小订单"],
    completeKey: COMPLETE_KEY["广州送样&小订单"],
    list: ORDER_LIST_SPECS["广州送样&小订单"],
  },
  "小试": {
    name: "小试",
    detailSql: SQL_XIAOSHI,
    stages: STAGE_SPECS["小试"],
    completeKey: COMPLETE_KEY["小试"],
    list: ORDER_LIST_SPECS["小试"],
  },
  "上海工艺实验": {
    name: "上海工艺实验",
    detailSql: SQL_SH_PROCESS_EXPERIMENT,
    stages: STAGE_SPECS["上海工艺实验"],
    completeKey: COMPLETE_KEY["上海工艺实验"],
    list: ORDER_LIST_SPECS["上海工艺实验"],
  },
  "OA辅助单": {
    name: "OA辅助单",
    detailSql: SQL_OA_ASSIST,
    stages: STAGE_SPECS["OA辅助单"],
    completeKey: COMPLETE_KEY["OA辅助单"],
    list: ORDER_LIST_SPECS["OA辅助单"],
  },
};

/** 按名称取业务范围；未知名称返回 undefined（调用方决定抛错还是提示） */
export function scopeOf(name: string): BusinessScope | undefined {
  return (BUSINESS_SCOPES as Record<string, BusinessScope>)[name];
}
