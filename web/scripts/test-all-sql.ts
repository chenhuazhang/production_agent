import sql from "mssql";

const SQLS: Record<string, string> = {
  "广州中试": `
SELECT DISTINCT TOP 3
    t.f52977  AS order_no,
    ISNULL(t.f140429, 0) AS extrusion_exception,
    ISNULL(t.f140425, 0) AS injection_strip_exception,
    ISNULL(t.f140430, 0) AS injection_color_plate_exception
FROM tabdiytable3393 t
LEFT JOIN tabdiytable3946 t2 ON t.f52977 = t2.f68150
CROSS JOIN (SELECT '王武龙' AS a) p
WHERE t.f52994 > @since`,

  "上海中试": `
SELECT DISTINCT TOP 3
    t2.f96425 AS order_no,
    ISNULL(t4.f140720, 0) AS extrusion_exception,
    ISNULL(t6.f140718, 0) AS injection_strip_exception,
    ISNULL(t5.f140719, 0) AS injection_color_plate_exception
FROM tabdiytable5724 t2
LEFT JOIN tabdiytable5698 t3 ON t2.f96425 = t3.f95892 AND t2.f96426 = t3.f95902
LEFT JOIN tabdiytable5699 t4 ON t2.f96425 = t4.f95904 AND t2.f96426 = t4.f95916
LEFT JOIN tabdiytable5707 t5 ON t2.f96425 = t5.f96198 AND t2.f96426 = t5.f96214
LEFT JOIN tabdiytable5711 t6 ON t2.f96425 = t6.f96280
LEFT JOIN tabdiytable5625 t7 ON t2.f96425 = t7.f94863 AND t2.f96426 = t7.f94872
LEFT JOIN tabdiytable5690 t8 ON t2.f96425 = t8.f95720
CROSS JOIN (SELECT '袁刚' AS a) p
WHERE t3.f95900 > @since`,

  "小试": `
SELECT DISTINCT TOP 3
    t.f102935 AS order_no,
    t.f102925 AS base,
    ISNULL(t.f140432, 0) AS extrusion_exception,
    ISNULL(t.f140431, 0) AS injection_strip_exception
FROM tabdiytable5992 t
CROSS JOIN (SELECT 'x' AS a) p
WHERE t.f102959 > @since`,

  "OA辅助单": `
SELECT DISTINCT TOP 3
    t.f138799 AS order_no,
    t2.f138796 AS base,
    ISNULL(t.f140730, 0) AS injection_strip_exception
FROM tabdiytable8460 t
LEFT JOIN tabdiytable8459 t2 ON t.ID = t2.ID
CROSS JOIN (SELECT 'x' AS a) p
WHERE t.f138823 > @since`,
};

async function main() {
  const pool = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000 },
    pool: { max: 5, min: 0 },
  }).connect();

  const since = "2026-01-01";

  for (const [name, sqlText] of Object.entries(SQLS)) {
    try {
      const req = pool.request();
      req.input("since", sql.NVarChar, since);
      const r = await req.query(sqlText);
      console.log(`✓ ${name}: ${r.recordset.length} rows`);
      if (r.recordset.length > 0) console.log(`  sample:`, JSON.stringify(r.recordset[0]));
    } catch (e) {
      console.log(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await pool.close();
}

main();
