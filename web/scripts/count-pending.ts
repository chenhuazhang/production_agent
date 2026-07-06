import sql from "mssql";

async function main() {
  const p = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 30_000 },
    pool: { max: 1, min: 0 },
  }).connect();

  const since = "2026-04-01"; // last 90 days

  // 广州中试: pending = 最终完成时间未填
  const r1 = await p.request().input("s", sql.NVarChar, since)
    .query(`SELECT COUNT(*) as total,
        SUM(CASE WHEN f53419 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN f53419 > '1900-01-02' THEN 1 ELSE 0 END) as completed
      FROM tabdiytable3393 WHERE f52994 > @s`);
  console.log("广州中试:", JSON.stringify(r1.recordset[0]));

  // 上海中试 (simple base query, no JOINs)
  // Note: this is approximate since we can't join for final_complete_time quickly
  const r2 = await p.request()
    .query(`SELECT COUNT(*) as total FROM tabdiytable5724 WHERE f96425 IS NOT NULL`);
  console.log("上海中试 (base only):", JSON.stringify(r2.recordset[0]));
  console.log("  (需要 JOIN 才能判断完成状态，暂用全量)");

  // 小试 - with base breakdown
  const r3 = await p.request().input("s", sql.NVarChar, since)
    .query(`SELECT f102925 AS base,
        COUNT(*) as total,
        SUM(CASE WHEN f102967 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN f102967 > '1900-01-02' THEN 1 ELSE 0 END) as completed
      FROM tabdiytable5992 WHERE f102959 > @s
      GROUP BY f102925 ORDER BY f102925`);
  console.log("\n小试 (by base):");
  for (const row of r3.recordset) {
    console.log(`  ${row.base}: total=${row.total} pending=${row.pending} done=${row.completed}`);
  }

  // OA - with base breakdown
  const r4 = await p.request().input("s", sql.NVarChar, since)
    .query(`SELECT t2.f138796 AS base,
        COUNT(*) as total,
        SUM(CASE WHEN t.f138978 IS NULL OR t.f138978 <= '1900-01-02' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN t.f138978 > '1900-01-02' THEN 1 ELSE 0 END) as completed
      FROM tabdiytable8460 t
      LEFT JOIN tabdiytable8459 t2 ON t.ID = t2.ID
      WHERE t.f138823 > @s
      GROUP BY t2.f138796 ORDER BY t2.f138796`);
  console.log("\nOA辅助单 (by base):");
  for (const row of r4.recordset) {
    console.log(`  ${row.base || 'NULL'}: total=${row.total} pending=${row.pending} done=${row.completed}`);
  }

  await p.close();
}
main();
