import sql from "mssql";

async function main() {
  const p = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 15_000 },
    pool: { max: 1, min: 0 },
  }).connect();

  console.log("=== tabdiytable3439 WHERE F136277 = '广州' ===");
  const r1 = await p.request().query("SELECT * FROM tabdiytable3439 WHERE F136277 = '广州'");
  console.log(`Rows: ${r1.recordset.length}`);
  for (const row of r1.recordset) {
    console.log(JSON.stringify(row));
  }

  console.log("\n=== All distinct f136277 values ===");
  const r2 = await p.request().query("SELECT DISTINCT f136277 FROM tabdiytable3439 WHERE f136277 IS NOT NULL AND f136277 != ''");
  console.log(r2.recordset.map((r: any) => r.f136277));

  console.log("\n=== tabdiytable3439 WHERE F136277 = '广州' and f53444 in relevant roles ===");
  const r3 = await p.request().query(`
    SELECT f136277, f53444, f53443
    FROM tabdiytable3439
    WHERE F136277 = '广州' AND f53444 IN ('混料', '挤出', '注塑', '最终班长', '排产')
  `);
  for (const row of r3.recordset) {
    console.log(`  base=${row.f136277}  role=${row.f53444}  person=${row.f53443}`);
  }

  await p.close();
}
main();
