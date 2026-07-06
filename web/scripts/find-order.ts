import sql from "mssql";

async function main() {
  const p = await new sql.ConnectionPool({
    server: "172.18.28.88", port: 1433, database: "db1",
    user: "sa", password: "qianyonghong1974@hotmail.com",
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 10_000, requestTimeout: 15_000 },
    pool: { max: 1, min: 0 },
  }).connect();

  const r = await p.request()
    .input("o", sql.NVarChar, "EX20260601-386")
    .query(`SELECT
      f102935 AS order_no,
      f102925 AS base,
      f102932 AS machine,
      f102936 AS order_count,
      f140432 AS extrusion_exception,
      f140431 AS injection_strip_exception,
      f102950 AS create_order_time,
      f140798 AS scheduling_time,
      f102957 AS color_powder_measure_time,
      f102959 AS mixing_time,
      f102961 AS extrusion_time,
      f102994 AS injection_strip_time,
      f102967 AS final_complete_time
    FROM tabdiytable5992 WHERE f102935 = @o`);

  const row = r.recordset[0];
  if (!row) { console.log("Not found"); await p.close(); return; }

  const isDate = (v: any) => {
    if (!v) return false;
    const d = new Date(v);
    return d.getFullYear() > 1900;
  };

  console.log(`订单: ${row.order_no}`);
  console.log(`基地: ${row.base}  机台: ${row.machine}  数量: ${row.order_count}`);
  console.log(`挤出异常: ${row.extrusion_exception}  注塑异常: ${row.injection_strip_exception}`);
  console.log();
  console.log("工序时间线:");
  console.log(`  排产:     ${isDate(row.scheduling_time) ? new Date(row.scheduling_time).toLocaleString() : '未完成'}`);
  console.log(`  色粉计量: ${isDate(row.color_powder_measure_time) ? new Date(row.color_powder_measure_time).toLocaleString() : '未完成'}`);
  console.log(`  混料:     ${isDate(row.mixing_time) ? new Date(row.mixing_time).toLocaleString() : '未完成'}`);
  console.log(`  挤出:     ${isDate(row.extrusion_time) ? new Date(row.extrusion_time).toLocaleString() : '未完成'}`);
  console.log(`  注塑样条: ${isDate(row.injection_strip_time) ? new Date(row.injection_strip_time).toLocaleString() : '未完成'}`);
  console.log(`  最终完成: ${isDate(row.final_complete_time) ? new Date(row.final_complete_time).toLocaleString() : '未完成'}`);

  // Status
  const hasFinal = isDate(row.final_complete_time);
  const stages = ["排产", "色粉计量", "混料", "挤出", "注塑样条"];
  const times = [row.scheduling_time, row.color_powder_measure_time, row.mixing_time, row.extrusion_time, row.injection_strip_time];
  let lastDone = -1;
  for (let i = times.length - 1; i >= 0; i--) {
    if (isDate(times[i])) { lastDone = i; break; }
  }
  const currentStage = hasFinal ? "最终完成" : lastDone >= 0 ? stages[lastDone + 1] || stages[lastDone] : stages[0];

  console.log();
  console.log(`状态: ${hasFinal ? '已完成' : '生产中'}`);
  console.log(`当前工序: ${currentStage}`);

  await p.close();
}
main();
