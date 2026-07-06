import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "data", "app.db");
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  const extraNames = ["东莞基地", "苏州基地"];

  for (const name of extraNames) {
    const base = await prisma.base.findFirst({ where: { name } });
    if (!base) {
      console.log(`${name} not found, skipping`);
      continue;
    }

    // Delete all related records in order
    await prisma.capacitySnapshot.deleteMany({ where: { baseId: base.id } });

    const orders = await prisma.order.findMany({ where: { baseId: base.id }, select: { id: true } });
    for (const o of orders) {
      await prisma.processStage.deleteMany({ where: { orderId: o.id } });
    }
    await prisma.order.deleteMany({ where: { baseId: base.id } });

    await prisma.base.delete({ where: { id: base.id } });

    console.log(`Deleted ${name} and all related orders/stages`);
  }

  const remaining = await prisma.base.findMany();
  console.log(`\nRemaining ${remaining.length} bases:`);
  remaining.forEach((b) => console.log(`  ${b.name} (${b.location})`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
