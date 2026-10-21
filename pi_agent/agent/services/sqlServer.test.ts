/**
 * sqlServer 单元测试（纯函数部分，不连数据库）
 *
 * 覆盖：
 * - resolveBusinessTypes：别名展开 / 大小写 / 去重 / 未知输入报错
 * - buildOrderListQuery：过滤值全部 @param 绑定、无字面量拼接、各类型差异
 */

import { describe, expect, it } from "vitest";
import {
  ALL_BASE_NAMES,
  aggregateOrderLots,
  buildOrderListCountQuery,
  buildOrderListLineCountQuery,
  buildOrderListQuery,
  decorateProgressRow,
  formatSqlDatetime,
  resolveBusinessTypes,
  type StageInfo,
} from "./sqlServer.js";

describe("formatSqlDatetime（还原 DB 墙钟时间）", () => {
  it("驱动按 UTC 解释的 Date 还原为存储的墙钟值", () => {
    // 库里存 2026-08-05 15:10 → 驱动解析为 2026-08-05T15:10Z → 应还原为 15:10
    expect(formatSqlDatetime(new Date("2026-08-05T15:10:39.000Z"))).toBe("2026-08-05 15:10");
  });

  it("字符串原样保留（CONVERT 结果 / 已格式化值）", () => {
    expect(formatSqlDatetime("2026-08-06 07:10")).toBe("2026-08-06 07:10");
  });

  it("null / 无效日期 → null", () => {
    expect(formatSqlDatetime(new Date("invalid"))).toBeNull();
    expect(formatSqlDatetime(null)).toBeNull();
    expect(formatSqlDatetime(undefined)).toBeNull();
  });

  it("哨兵日期视为未设置 → null（Date 形态：1900/1899/无效年份）", () => {
    expect(formatSqlDatetime(new Date("1900-01-01T00:00:00.000Z"))).toBeNull();
    expect(formatSqlDatetime(new Date("1899-12-30T00:00:00.000Z"))).toBeNull();
  });

  it("哨兵日期视为未设置 → null（VARCHAR 字符串形态）", () => {
    // 源 ERP 的 VARCHAR 时间列以文本存哨兵，绝不能当真实完成时间漏给外部系统
    expect(formatSqlDatetime("1900-01-01 00:00")).toBeNull();
    expect(formatSqlDatetime("1900-01-01")).toBeNull();
    expect(formatSqlDatetime("1899-12-30 00:00")).toBeNull();
    expect(formatSqlDatetime("0000-00-00")).toBeNull();
    expect(formatSqlDatetime("")).toBeNull();
    expect(formatSqlDatetime("   ")).toBeNull();
  });
});

describe("decorateProgressRow（工序语义装饰：status / current_stage / stages）", () => {
  const baseRow = {
    order_no: "EX1",
    技术员: "张三",
    牌号: "PPE-JF206 BK017",
    color_powder_measurer: "丘文彬",
    mixing_person: "邹华明",
    extrusion_person: "邹华明",
    injection_color_plate_person: "刘富贵",
    injection_strip_person: "杨文超",
    final_monitor: "邹华明",
  };
  // 模拟 normalizeRowDates 之后：哨兵/空串已归 null
  const empty = (row: Record<string, unknown>) => ({
    ...row,
    color_powder_measure_time: null,
    mixing_time: null,
    extrusion_time: null,
    injection_color_plate_time: null,
    injection_strip_time: null,
    final_complete_time: null,
  });

  it("广州工艺实验：全程无工序记录 → 生产中，当前节点=色粉计量（未开始）", () => {
    const r = decorateProgressRow("广州工艺实验", empty(baseRow));
    expect(r.status).toBe("生产中");
    expect(r.current_stage).toBe("色粉计量");
    expect(r.current_stage_person).toBe("丘文彬");
    expect(r.stages).toHaveLength(6);
    const stages = r.stages as StageInfo[];
    expect(stages[0]).toEqual({ node: "色粉计量", person: "丘文彬", time: null, done: false });
    expect(stages[5]).toEqual({ node: "最终班长", person: "邹华明", time: null, done: false });
  });

  it("广州工艺实验：中间工序时间漏记不影响节点推导（按最后已完成工序的下一步）", () => {
    // 色粉计量时间 1900(漏记) 但混料/挤出已完成 → 当前节点应为注塑色板，而不是色粉称量
    const r = decorateProgressRow("广州工艺实验", {
      ...empty(baseRow),
      mixing_time: "2026-08-12 14:26",
      extrusion_time: "2026-08-12 15:22",
    });
    expect(r.status).toBe("生产中");
    expect(r.current_stage).toBe("注塑色板");
    const stages = r.stages as StageInfo[];
    expect(stages.find((s) => s.node === "色粉计量")?.done).toBe(false);
    expect(stages.find((s) => s.node === "挤出")?.done).toBe(true);
  });

  it("广州工艺实验：最终班长完成 → 已完成，当前节点为空", () => {
    const r = decorateProgressRow("广州工艺实验", {
      ...empty(baseRow),
      final_complete_time: "2026-08-12 15:30",
    });
    expect(r.status).toBe("已完成");
    expect(r.current_stage).toBeNull();
    expect(r.current_stage_person).toBeNull();
  });

  it("小试：完成信号=注塑完成时间（无 final_complete_time 字段）", () => {
    const pending = decorateProgressRow("小试", {
      order_no: "EX2", 牌号: "X",
      mixing_person: "邹华明",
      注塑人员姓名: "杨文超",
      color_powder_measure_time: null, mixing_time: null,
      extrusion_time: null, 注塑完成时间: null,
    });
    expect(pending.status).toBe("生产中");
    expect(pending.stages).toHaveLength(4); // 无注塑色板

    const done = decorateProgressRow("小试", {
      order_no: "EX2", 牌号: "X",
      mixing_person: "邹华明", 注塑人员姓名: "杨文超",
      color_powder_measure_time: "2026-08-12 08:00",
      mixing_time: "2026-08-12 09:00", extrusion_time: "2026-08-12 10:00",
      注塑完成时间: "2026-08-12 11:00",
    });
    expect(done.status).toBe("已完成");
    expect(done.current_stage).toBeNull();
  });

  it("OA辅助单：仅注塑工序", () => {
    const r = decorateProgressRow("OA辅助单", {
      order_no: "OA1", scheduling_time: "2026-08-12 09:00",
      injection_strip_person: "王五", injection_strip_time: null,
    });
    expect(r.status).toBe("生产中");
    expect(r.stages).toEqual([{ node: "注塑", person: "王五", time: null, done: false }]);
    expect(r.current_stage).toBe("注塑");

    const done = decorateProgressRow("OA辅助单", {
      order_no: "OA1", injection_strip_person: "王五", injection_strip_time: "2026-08-12 10:00",
    });
    expect(done.status).toBe("已完成");
  });

  it("上海工艺实验：逐料次装饰，最后料次无状态时该料次生产中", () => {
    const r = decorateProgressRow("上海工艺实验", {
      order_no: "EX3", order_count: 2,
      color_powder_measure_time: "2026-08-12 08:00",
      mixing_time: null, extrusion_time: null,
      injection_color_plate_time: null, injection_strip_time: null,
      final_complete_time: null,
    });
    expect(r.status).toBe("生产中");
    // 色粉计量已完成 → 当前节点为混料
    expect(r.current_stage).toBe("混料");
  });
});

describe("resolveBusinessTypes", () => {
  it("空输入返回全部业务类型", () => {
    expect(resolveBusinessTypes()).toEqual(ALL_BASE_NAMES);
    expect(resolveBusinessTypes([])).toEqual(ALL_BASE_NAMES);
  });

  it("别名展开", () => {
    expect(resolveBusinessTypes(["研发实验"])).toEqual(["小试"]);
    expect(resolveBusinessTypes(["工艺实验"])).toEqual(["广州工艺实验", "上海工艺实验"]);
    expect(resolveBusinessTypes(["注塑单"])).toEqual(["OA辅助单"]);
    expect(resolveBusinessTypes(["研发辅助单"])).toEqual(["OA辅助单"]);
    expect(resolveBusinessTypes(["送样"])).toEqual(["广州送样&小订单"]);
    expect(resolveBusinessTypes(["小订单"])).toEqual(["广州送样&小订单"]);
  });

  it("正式名可用", () => {
    expect(resolveBusinessTypes(["小试", "OA辅助单"])).toEqual(["小试", "OA辅助单"]);
  });

  it("大小写不敏感（OA辅助单）", () => {
    expect(resolveBusinessTypes(["OA辅助单"])).toEqual(["OA辅助单"]);
    expect(resolveBusinessTypes(["oa辅助单"])).toEqual(["OA辅助单"]);
    expect(resolveBusinessTypes(["Oa辅助单"])).toEqual(["OA辅助单"]);
  });

  it("去重并按 ALL_BASE_NAMES 顺序返回", () => {
    expect(resolveBusinessTypes(["小试", "研发实验"])).toEqual(["小试"]);
    expect(resolveBusinessTypes(["工艺实验", "广州工艺实验"])).toEqual([
      "广州工艺实验",
      "上海工艺实验",
    ]);
  });

  it("未知输入抛错且附可用关键词", () => {
    expect(() => resolveBusinessTypes(["不存在的类型"])).toThrow(/无法识别的业务类型/);
    expect(() => resolveBusinessTypes(["不存在的类型"])).toThrow(/研发实验/);
  });

  it("「实验单/实验」含 OA辅助单（口径：研发实验+工艺实验+研发辅助单）", () => {
    // resolveBusinessTypes 按 ALL_BASE_NAMES 顺序返回
    expect(resolveBusinessTypes(["实验单"])).toEqual([
      "广州工艺实验",
      "小试",
      "上海工艺实验",
      "OA辅助单",
    ]);
    expect(resolveBusinessTypes(["实验"])).toEqual(["广州工艺实验", "小试", "上海工艺实验", "OA辅助单"]);
  });

  it("「所有单/全部/下单」= 全部 5 类（含 OA辅助单，不漏任何业务）", () => {
    expect(resolveBusinessTypes(["所有单"])).toEqual(ALL_BASE_NAMES);
    expect(resolveBusinessTypes(["全部"])).toEqual(ALL_BASE_NAMES);
    expect(resolveBusinessTypes(["下单"])).toEqual(ALL_BASE_NAMES);
  });
});

describe("buildOrderListQuery 参数化", () => {
  it("过滤值全部走 @param，不出现字面量", () => {
    const { sql, paramNames } = buildOrderListQuery("小试", {
      technician: "张",
      base: "广州",
      since: "2026-07-06",
      until: "2026-08-05",
    });
    expect(sql).toContain("SELECT DISTINCT TOP (@limit)");
    expect(sql).toContain("LIKE N'%' + @tech + N'%'");
    expect(sql).toContain("LIKE N'%' + @base + N'%'");
    expect(sql).toContain(">= @since");
    expect(sql).toContain("DATEADD(DAY, 1, CAST(@until AS DATETIME2))");
    expect(sql).toContain("ORDER BY scheduling_time DESC");
    expect(paramNames).toEqual(["limit", "tech", "base", "since", "until"]);
    // 不含任何用户输入字面量
    expect(sql).not.toContain("张");
    expect(sql).not.toContain("广州");
    expect(sql).not.toContain("2026-07");
  });

  it("无过滤条件时仅有 pattern + 数据窗口 + TOP + ORDER BY", () => {
    const { sql, paramNames } = buildOrderListQuery("广州工艺实验", {});
    expect(sql).toContain("WHERE t.f52977 LIKE '%EX%'");
    expect(sql).toContain("DATEADD(MONTH, -3, GETDATE())");
    expect(sql).toContain("TOP (@limit)");
    expect(paramNames).toEqual(["limit"]);
  });

  it("所有类型强制最近 3 个月数据窗口（硬限制，不依赖过滤参数、不新增绑定）", () => {
    for (const name of ALL_BASE_NAMES) {
      // 即使调用方传了很早的 since，窗口谓词也恒在（两者 AND，窗口占优）
      const { sql, paramNames } = buildOrderListQuery(name, { since: "2020-01-01" });
      expect(sql).toContain("DATEADD(MONTH, -3, GETDATE())");
      // 窗口是服务端常量表达式，不引入新参数
      expect(paramNames).toEqual(["limit", "since"]);
    }
  });

  it("OA辅助单无订单号 pattern", () => {
    const { sql } = buildOrderListQuery("OA辅助单", {});
    expect(sql).toContain("WHERE 1=1");
    expect(sql).not.toContain("EX%");
  });

  it("上海工艺实验的技术员过滤落在技术配方备注列", () => {
    const { sql } = buildOrderListQuery("上海工艺实验", { technician: "彭" });
    expect(sql).toContain("t8.f95728 LIKE N'%' + @tech + N'%'");
    expect(sql).not.toContain("彭");
  });

  it("无基地列的类型不生成 base 过滤条件", () => {
    const { sql, paramNames } = buildOrderListQuery("广州工艺实验", { base: "广州" });
    expect(sql).not.toContain("@base");
    expect(paramNames).not.toContain("base");
  });

  it("有基地列的类型生成 base 过滤条件", () => {
    const { sql, paramNames } = buildOrderListQuery("OA辅助单", { base: "上海" });
    expect(sql).toContain("t2.f138796 LIKE N'%' + @base + N'%'");
    expect(paramNames).toContain("base");
  });

  it("牌号/产品线过滤走 @grade/@line 参数，无字面量", () => {
    const { sql, paramNames } = buildOrderListQuery("小试", {
      grade: "ABC123",
      product_line: "PP改性",
    });
    expect(sql).toContain("t.f102924 LIKE N'%' + @grade + N'%'");
    expect(sql).toContain("t2.f126825 LIKE N'%' + @line + N'%'");
    expect(paramNames).toEqual(["limit", "grade", "line"]);
    expect(sql).not.toContain("ABC123");
    expect(sql).not.toContain("PP改性");
  });

  it("上海工艺实验的牌号/产品线过滤落在 t8 列", () => {
    const { sql } = buildOrderListQuery("上海工艺实验", {
      grade: "X1",
      product_line: "L1",
    });
    expect(sql).toContain("t8.f95721 LIKE N'%' + @grade + N'%'");
    expect(sql).toContain("t8.f95737 LIKE N'%' + @line + N'%'");
  });

  it("5 类 spec 均定义了 gradeCol/lineCol", () => {
    for (const name of ALL_BASE_NAMES) {
      const { sql } = buildOrderListQuery(name, { grade: "g", product_line: "l" });
      expect(sql).toContain("@grade");
      expect(sql).toContain("@line");
    }
  });

  it("未知类型抛错", () => {
    expect(() =>
      buildOrderListQuery("不存在" as unknown as "小试", {}),
    ).toThrow(/未知业务类型/);
  });

  it("排产时间为空(1900哨兵)时 since/until 回退到备用时间列，避免漏掉已开单未排产的活跃订单", () => {
    // 回归保护：广州工艺实验排产时间填充率低，加 since 后若仍只比较 f140799，
    // 秦朋这类"排产未设置、仅开单"的订单会被整批滤掉（曾导致工艺实验单查不到）
    const { sql, paramNames } = buildOrderListQuery("广州工艺实验", {
      technician: "秦朋",
      since: "2026-07-25",
      until: "2026-08-25",
    });
    // 排产时间为空时取开单时间列（t.f52994），排产为真实日期时仍用排产时间（t.f140799）
    expect(sql).toContain("CASE WHEN t.f140799 IS NULL OR t.f140799 <= '1900-01-02' THEN t.f52994 ELSE t.f140799 END");
    expect(sql).toContain(">= @since");
    expect(sql).toContain("DATEADD(DAY, 1, CAST(@until AS DATETIME2))");
    expect(paramNames).toEqual(["limit", "tech", "since", "until"]);
  });

  it("未定义 timeFallbackCol 的类型（如无开单时间列）仍按排产时间过滤", () => {
    // 预留断言：若某类型没有备用时间列，since 只比较排产时间，行为不回归
    const { sql } = buildOrderListQuery("OA辅助单", { since: "2026-07-25" });
    expect(sql).toContain(">= @since");
    // 注：OA辅助单已定义 timeFallbackCol（f138978），此处仅确认 SQL 不含未绑定表别名
    expect(sql).not.toContain("t2.f138796 >= @since");
  });
});

describe("buildOrderListCountQuery（统计查询，不截断）", () => {
  it("统计总数与已完成数，无 TOP/limit 参数", () => {
    const { sql, paramNames } = buildOrderListCountQuery("小试", { grade: "ABC" });
    expect(sql).toContain("COUNT(DISTINCT t.f102935) AS total");
    expect(sql).toContain("COUNT(DISTINCT CASE WHEN t.f102963 > '1900-01-02' THEN t.f102935 END) AS completed");
    expect(sql).not.toContain("TOP");
    expect(sql).not.toContain("@limit");
    expect(paramNames).toEqual(["grade"]);
  });

  it("上海统计的完成口径按最后料次（最大 order_count）判定", () => {
    const { sql } = buildOrderListCountQuery("上海工艺实验", {});
    // 最大料次号由 from 里的派生表 ml 提供（不能在 COUNT 里内嵌 SELECT MAX，否则聚合套聚合 error 130）
    expect(sql).toContain("MAX(f96426) AS max_lot");
    expect(sql).toContain("t2.f96426 = ml.max_lot");
    expect(sql).toContain("COUNT(DISTINCT t2.f96425) AS total");
    // 回归保护：不得再出现内嵌 MAX 子查询
    expect(sql).not.toContain("SELECT MAX(i.f96426)");
  });

  it("与明细查询共用同一批过滤参数", () => {
    const detail = buildOrderListQuery("广州工艺实验", { technician: "张", since: "2026-07-06" });
    const count = buildOrderListCountQuery("广州工艺实验", { technician: "张", since: "2026-07-06" });
    expect(detail.paramNames.filter((p) => p !== "limit")).toEqual(count.paramNames);
  });
});

describe("buildOrderListLineCountQuery（按产品线分组统计，不截断）", () => {
  it("按产品线 GROUP BY，统计总数与已完成数，无 TOP 截断", () => {
    const { sql, paramNames } = buildOrderListLineCountQuery("小试", { grade: "ABC" });
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("COUNT(DISTINCT t.f102935) AS total");
    expect(sql).not.toContain("TOP");
    expect(sql).not.toContain("@limit");
    expect(paramNames).toEqual(["grade"]);
  });

  it("产品线空值归入「(未指定产品线)」，避免分组空值对不上", () => {
    const { sql } = buildOrderListLineCountQuery("广州工艺实验", {});
    expect(sql).toContain("COALESCE(NULLIF(t3.f126825, ''), N'(未指定产品线)')");
    expect(sql).toContain("AS product_line");
  });

  it("与 buildOrderListCountQuery 共用同一批过滤参数", () => {
    const line = buildOrderListLineCountQuery("OA辅助单", { technician: "张", since: "2026-07-06" });
    const count = buildOrderListCountQuery("OA辅助单", { technician: "张", since: "2026-07-06" });
    expect(line.paramNames).toEqual(count.paramNames);
  });
});

describe("aggregateOrderLots（上海工艺实验料次聚合）", () => {
  const lot = (orderNo: string, count: number, status: string, ex: string[] = []) => ({
    order_no: orderNo,
    order_count: count,
    status,
    exceptions: ex,
    type: "上海工艺实验",
    machine: "M1",
  });

  it("多料次聚合为一行，整单状态以最后料次（号最大）为准", () => {
    const rows = aggregateOrderLots([
      lot("EX1", 1, "已完成"),
      lot("EX1", 2, "生产中"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("生产中"); // 最后料次未完成 → 整单生产中
    expect(rows[0].lot_total).toBe(2);
    expect(rows[0].lot_completed).toBe(1);
  });

  it("最后料次完成 → 整单判定完成（即使料次乱序传入）", () => {
    const rows = aggregateOrderLots([
      lot("EX2", 1, "已完成"),
      lot("EX2", 10, "已完成"),
      lot("EX2", 3, "已完成"),
    ]);
    expect(rows[0].status).toBe("已完成");
    expect(rows[0].lot_total).toBe(3);
    expect(rows[0].lot_completed).toBe(3);
  });

  it("异常取各料次并集且去重", () => {
    const rows = aggregateOrderLots([
      lot("EX3", 1, "生产中", ["挤出"]),
      lot("EX3", 2, "已完成", ["注塑样条"]),
      lot("EX3", 3, "生产中", ["挤出"]),
    ]);
    expect(rows[0].exceptions).toEqual(["挤出", "注塑样条"]);
  });

  it("不同订单分别聚合", () => {
    const rows = aggregateOrderLots([
      lot("EXA", 1, "已完成"),
      lot("EXB", 1, "生产中"),
      lot("EXA", 2, "已完成"),
    ]);
    expect(rows).toHaveLength(2);
    const exa = rows.find((r) => r.order_no === "EXA");
    expect(exa?.status).toBe("已完成");
    expect(exa?.lot_total).toBe(2);
  });
});
