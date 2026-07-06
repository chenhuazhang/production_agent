import sql from "mssql";

async function main() {
  const p = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 15_000 },
    pool: { max: 1, min: 0 },
  }).connect();

  console.log("=== 各基地最新人员（小试 / OA 共用此查询） ===\n");

  const r = await p.request().query(`
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
    ORDER BY f136277
  `);

  for (const row of r.recordset) {
    console.log(`【${row.f136277}】`);
    console.log(`  混料: ${row['混料人员'] || '(空)'}`);
    console.log(`  挤出: ${row['挤出人员'] || '(空)'}`);
    console.log(`  注塑样条: ${row['注塑样条人员'] || '(空)'}`);
    console.log(`  最终班长: ${row['最终班长'] || '(空)'}`);
    console.log(`  排产: ${row['排产完成人员'] || '(空)'}`);
    console.log();
  }

  await p.close();
}

main();
