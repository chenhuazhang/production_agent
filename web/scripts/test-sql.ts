import sql from "mssql";

async function main() {
  try {
    console.log("Connecting to 172.18.28.88:1433...");
    const pool = await new sql.ConnectionPool({
      server: "172.18.28.88",
      port: 1433,
      database: "db1",
      user: "sa",
      password: "qianyonghong1974@hotmail.com",
      options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000 },
      pool: { max: 1, min: 0 },
    }).connect();
    console.log("Connected!");

    const since = "2026-01-01";
    const r = await pool
      .request()
      .input("since", sql.NVarChar, since)
      .query(
        "SELECT TOP 5 f52977 AS order_no, f52974 AS machine FROM tabdiytable3393 WHERE f52994 > @since ORDER BY f52994 DESC"
      );
    console.log("Sample orders:", JSON.stringify(r.recordset, null, 2));
    await pool.close();
    console.log("Done.");
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : String(e));
    if (e instanceof Error && "code" in e) console.error("Code:", (e as any).code);
  }
}

main();
