import sql from "mssql";

async function main() {
  const p = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 15_000 },
    pool: { max: 1, min: 0 },
  }).connect();

  // Check all timestamp columns for a few orders to understand the NULL vs 1900-01-01 pattern
  console.log("=== Checking timestamp patterns (5 orders) ===");
  const r = await p.request().query(`SELECT TOP 5
    f52977, f52994, f53049, f53051, f53053, f53055, f53419, f140799
  FROM tabdiytable3393 ORDER BY f52994 DESC`);

  for (const row of r.recordset) {
    const vals: Record<string,string> = {};
    for (const [k,v] of Object.entries(row)) {
      if (k === 'f52977') { vals[k] = String(v); continue; }
      if (v === null || v === undefined) { vals[k] = 'NULL'; continue; }
      const d = new Date(v as string);
      const year = d.getFullYear();
      if (year <= 1900) vals[k] = '1900(default)';
      else vals[k] = d.toISOString().slice(0,10);
    }
    console.log(`\n${vals.f52977}:`);
    console.log(`  开单(f52994):    ${vals.f52994}`);
    console.log(`  排产(f140799):   ${vals.f140799}`);
    console.log(`  色粉(f53049):    ${vals.f53049}`);
    console.log(`  混料(f53051):    ${vals.f53051}`);
    console.log(`  挤出(f53053):    ${vals.f53053}`);
    console.log(`  色板(f53055):    ${vals.f53055}`);
    console.log(`  完成(f53419):    ${vals.f53419}`);
  }

  // Find orders at different stages
  console.log("\n\n=== Orders where 挤出(f53053) is set but 色板(f53055) is default ===");
  const r2 = await p.request().query(`SELECT TOP 3 f52977, f53053, f53055, f53419
    FROM tabdiytable3393
    WHERE f53053 > '2026-01-01' AND f53055 <= '1900-01-02' AND f53419 <= '1900-01-02'
    ORDER BY f53053 DESC`);
  for (const row of r2.recordset) {
    console.log(`  ${row.f52977} | extrusion=${row.f53053} | color_plate=${row.f53055} | final=${row.f53419}`);
  }

  console.log("\n=== Orders where 色板(f53055) is set but 完成(f53419) is default ===");
  const r3 = await p.request().query(`SELECT TOP 3 f52977, f53055, f53419
    FROM tabdiytable3393
    WHERE f53055 > '2026-01-01' AND f53419 <= '1900-01-02'
    ORDER BY f53055 DESC`);
  for (const row of r3.recordset) {
    console.log(`  ${row.f52977} | color_plate=${row.f53055} | final=${row.f53419}`);
  }

  await p.close();
}
main();
