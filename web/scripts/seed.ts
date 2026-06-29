import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "data", "app.db");
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  const bases = [
    { name: "广州基地", location: "广东广州", machineCount: 12, perMachineDailyOutput: 8 },
    { name: "上海基地", location: "上海", machineCount: 10, perMachineDailyOutput: 10 },
    { name: "成都基地", location: "四川成都", machineCount: 15, perMachineDailyOutput: 7 },
    { name: "武汉基地", location: "湖北武汉", machineCount: 9, perMachineDailyOutput: 9 },
    { name: "天津基地", location: "天津", machineCount: 8, perMachineDailyOutput: 6 },
  ];

  for (const base of bases) {
    const created = await prisma.base.upsert({
      where: { id: `base-${base.name}` },
      update: {},
      create: {
        id: `base-${base.name}`,
        ...base,
      },
    });

    const dailyCapacity = base.machineCount * base.perMachineDailyOutput;
    const pendingOrders = Math.floor(Math.random() * dailyCapacity * 2);
    const loadRate = Math.round((pendingOrders / dailyCapacity) * 100 * 10) / 10;

    await prisma.capacitySnapshot.create({
      data: {
        baseId: created.id,
        pendingOrders,
        dailyCapacity,
        loadRate,
        overloadMultiplier: Math.round((pendingOrders / dailyCapacity) * 10) / 10,
        daysToComplete: Math.round((pendingOrders / dailyCapacity) * 10) / 10,
        snapshotDate: new Date(),
      },
    });
  }

  console.log("Created 5 bases with capacity snapshots");
  console.log("Seed completed!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
