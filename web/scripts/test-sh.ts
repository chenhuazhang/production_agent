import sql from "mssql";

async function main() {
  const pool = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 120_000 },
    pool: { max: 1, min: 0 },
  }).connect();

  const since = "2026-06-01";

  // Test 1: Just the main table
  console.log("Test 1: Main table only...");
  try {
    const r1 = await pool.request().input("since", sql.NVarChar, since)
      .query("SELECT TOP 5 f96425 AS order_no, f96435 AS machine, f96426 AS order_count FROM tabdiytable5724 WHERE f96425 IS NOT NULL");
    console.log("✓", r1.recordset.length, "rows:", JSON.stringify(r1.recordset[0]));
  } catch(e) { console.log("✗", (e as Error).message); }

  // Test 2: With one join
  console.log("\nTest 2: With mixing_time join...");
  try {
    const r2 = await pool.request().input("since", sql.NVarChar, since)
      .query(`SELECT TOP 5 t2.f96425 AS order_no, t3.f95900 AS mixing_time
              FROM tabdiytable5724 t2
              LEFT JOIN tabdiytable5698 t3 ON t2.f96425 = t3.f95892 AND t2.f96426 = t3.f95902
              WHERE t3.f95900 > @since`);
    console.log("✓", r2.recordset.length, "rows:", JSON.stringify(r2.recordset[0]));
  } catch(e) { console.log("✗", (e as Error).message); }

  // Test 3: Full query without CONVERT
  console.log("\nTest 3: Full query...");
  try {
    const t0 = Date.now();
    const r3 = await pool.request().input("since", sql.NVarChar, since)
      .query(`SELECT
    t2.f96425 AS order_no, t2.f96435 AS machine, t2.f96426 AS order_count,
    t4.f140720 AS extrusion_exception, t6.f140718 AS injection_strip_exception, t5.f140719 AS injection_color_plate_exception,
    t2.f96428 AS color_powder_measure_time, t3.f95900 AS mixing_time, t4.f95913 AS extrusion_time,
    t5.f96212 AS injection_color_plate_time, t6.f96290 AS injection_strip_time,
    t7.f94880 AS final_complete_time, t8.f140800 AS scheduling_time
FROM tabdiytable5724 t2
LEFT JOIN tabdiytable5698 t3 ON t2.f96425 = t3.f95892 AND t2.f96426 = t3.f95902
LEFT JOIN tabdiytable5699 t4 ON t2.f96425 = t4.f95904 AND t2.f96426 = t4.f95916
LEFT JOIN tabdiytable5707 t5 ON t2.f96425 = t5.f96198 AND t2.f96426 = t5.f96214
LEFT JOIN tabdiytable5711 t6 ON t2.f96425 = t6.f96280
LEFT JOIN tabdiytable5625 t7 ON t2.f96425 = t7.f94863 AND t2.f96426 = t7.f94872
LEFT JOIN tabdiytable5690 t8 ON t2.f96425 = t8.f95720
WHERE t3.f95900 > @since`);
    console.log(`✓ ${r3.recordset.length} rows in ${Date.now() - t0}ms`);
    console.log("Sample:", JSON.stringify(r3.recordset[0]));
  } catch(e) { console.log("✗", (e as Error).message); }

  await pool.close();
}
main();
