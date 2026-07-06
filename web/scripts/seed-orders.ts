import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "data", "app.db");
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

// ── Real personnel per data source ──

const GZ_PERSONNEL = {
  开单: "王武龙",
  排产: "杨东东",
  色粉计量: "丘文彬",
  混料: "邹华明",
  挤出: "邹华明",
  注塑色板: "刘富贵",
  注塑样条: "杨文超",
  最终完成: "邹华明",
};

const SH_PERSONNEL = {
  排产: "彭江苇",
  色粉计量: "袁刚",
  混料: "彭江苇",
  挤出: "彭江苇",
  注塑色板: "杨建洲",
  注塑样条: "杨建洲",
  最终完成: "彭江苇",
};

const XS_PERSONNEL = {
  排产: "李志强",
  色粉计量: "周建国",
  混料: "黄文斌",
  挤出: "赵永刚",
  注塑样条: "陈伟明",
  最终完成: "孙海涛",
};

// ── Process stage definitions per data source (matching real SQL fields) ──

interface StageDef {
  name: string;
}

// 广州中试: 8 stages (has 开单 + 注塑色板 + 注塑样条)
const GZ_STAGES: StageDef[] = [
  { name: "开单" },
  { name: "排产" },
  { name: "色粉计量" },
  { name: "混料" },
  { name: "挤出" },
  { name: "注塑色板" },
  { name: "注塑样条" },
  { name: "最终完成" },
];

// 上海中试: 7 stages (no 开单, has 注塑色板 + 注塑样条)
const SH_STAGES: StageDef[] = [
  { name: "排产" },
  { name: "色粉计量" },
  { name: "混料" },
  { name: "挤出" },
  { name: "注塑色板" },
  { name: "注塑样条" },
  { name: "最终完成" },
];

// 小试: 6 stages (no 开单, no 注塑色板)
const XS_STAGES: StageDef[] = [
  { name: "排产" },
  { name: "色粉计量" },
  { name: "混料" },
  { name: "挤出" },
  { name: "注塑样条" },
  { name: "最终完成" },
];

// ── Helper functions ──

const PRODUCTS = [
  "PC阻燃材料", "PA6增强尼龙", "ABS合金", "PP改性料",
  "PBT工程塑料", "POM聚甲醛", "TPE弹性体", "PC/ABS合金",
  "PA66增强", "PET回收料",
];

const CUSTOMERS = [
  "广东某某科技有限公司", "上海新材塑胶有限公司", "成都华西材料厂",
  "武汉东风零部件", "天津渤海化工", "深圳恒达电子", "北京新材料研究所",
  "杭州锦江集团", "南京扬子石化", "重庆长安汽车",
];

const CITIES = ["广州", "深圳", "上海", "成都", "武汉", "天津", "北京", "杭州", "南京", "重庆"];

const MACHINES: Record<string, string[]> = {
  "广州基地": ["GZ-01", "GZ-02", "GZ-03", "GZ-05", "GZ-06"],
  "上海基地": ["SH-01", "SH-02", "SH-03", "SH-04"],
  "天津基地": ["TJ-01", "TJ-02", "TJ-03"],
  "武汉基地": ["WH-01", "WH-02", "WH-03"],
  "成都基地": ["CD-01", "CD-02", "CD-03", "CD-04"],
};

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - days * 86400000 + rand(0, 23) * 3600000 + rand(0, 59) * 60000);
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + days * 86400000 + rand(8, 18) * 3600000);
}

function getStageDefs(baseName: string): StageDef[] {
  switch (baseName) {
    case "广州基地": return GZ_STAGES;
    case "上海基地": return SH_STAGES;
    default: return XS_STAGES;
  }
}

function getPersonnel(baseName: string, stageName: string): string | null {
  switch (baseName) {
    case "广州基地": return (GZ_PERSONNEL as Record<string, string>)[stageName] || null;
    case "上海基地": return (SH_PERSONNEL as Record<string, string>)[stageName] || null;
    default: return (XS_PERSONNEL as Record<string, string>)[stageName] || null;
  }
}

function hasException(baseName: string, exceptionType: string): boolean {
  // Only GZ/SH can have color plate exception (注塑色板异常)
  if (exceptionType === "color_plate") {
    return baseName === "广州基地" || baseName === "上海基地";
  }
  return true;
}

// ── Main ──

async function main() {
  console.log("Seeding orders with real process flows...\n");

  const bases = await prisma.base.findMany({ where: { active: true } });
  if (bases.length === 0) {
    console.error("No bases found. Run 'npm run prisma:seed' first.");
    process.exit(1);
  }

  // Delete existing orders
  await prisma.processStage.deleteMany();
  await prisma.order.deleteMany();

  const basePrefix: Record<string, string> = {
    "广州基地": "GZ", "上海基地": "SH", "天津基地": "TJ",
    "武汉基地": "WH", "成都基地": "CD",
  };

  let totalOrders = 0;

  for (const base of bases) {
    const prefix = basePrefix[base.name] || base.name.substring(0, 2);
    const orderCount = base.name === "广州基地" || base.name === "上海基地" ? rand(30, 40) : rand(15, 25);
    const stages = getStageDefs(base.name);
    const machines = MACHINES[base.name] || ["M-01"];

    for (let i = 1; i <= orderCount; i++) {
      // Distribute statuses: ~15% not_started, ~55% in_progress, ~30% completed
      const statusRoll = Math.random();
      let status: string;
      if (statusRoll < 0.15) status = "not_started";
      else if (statusRoll < 0.70) status = "in_progress";
      else status = "completed";

      const priority = Math.random() < 0.15 ? "urgent" : "normal";

      // Delivery date logic
      let deliveryDate: Date;
      if (status === "completed") {
        deliveryDate = daysAgo(rand(1, 14));
      } else if (status === "in_progress") {
        const roll = Math.random();
        if (roll < 0.12) deliveryDate = daysAgo(rand(1, 5));
        else if (roll < 0.25) deliveryDate = daysFromNow(rand(0, 2));
        else deliveryDate = daysFromNow(rand(3, 10));
      } else {
        deliveryDate = daysFromNow(rand(5, 20));
      }

      // Exception flags (~8% chance per type)
      const extEx = hasException(base.name, "extrusion") && Math.random() < 0.08;
      const stripEx = hasException(base.name, "strip") && Math.random() < 0.08;
      const colorPlateEx = hasException(base.name, "color_plate") && Math.random() < 0.08;

      // Determine progress within stages
      let completedStageCount: number;
      if (status === "completed") completedStageCount = stages.length;
      else if (status === "not_started") completedStageCount = 0;
      else completedStageCount = rand(1, stages.length - 1); // at least 1 done, at least 1 remaining

      const currentStage = status === "completed"
        ? stages[stages.length - 1].name
        : status === "not_started" ? stages[0].name : stages[completedStageCount].name;

      const order = await prisma.order.create({
        data: {
          baseId: base.id,
          orderNumber: `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(i).padStart(3, "0")}`,
          productName: pick(PRODUCTS),
          customerName: `${pick(CITIES)}${pick(CUSTOMERS).replace(/.*有限公司/, "有限公司")}`,
          machine: pick(machines),
          orderCount: rand(1, 8),
          status,
          priority,
          deliveryDate,
          currentStage,
          extrusionException: extEx,
          injectionStripException: stripEx,
          injectionColorPlateException: colorPlateEx,
        },
      });

      // Create process stages
      for (let si = 0; si < stages.length; si++) {
        let stageStatus: string;
        if (status === "completed") {
          stageStatus = "completed";
        } else if (status === "not_started") {
          stageStatus = "pending";
        } else {
          if (si < completedStageCount) stageStatus = "completed";
          else if (si === completedStageCount) stageStatus = "in_progress";
          else stageStatus = "pending";
        }

        // Calculate completedAt: earlier stages completed further in the past
        let completedAt: Date | null = null;
        if (stageStatus === "completed") {
          completedAt = daysAgo(rand(2, 14) - si * 2);
        }

        await prisma.processStage.create({
          data: {
            orderId: order.id,
            name: stages[si].name,
            status: stageStatus,
            person: getPersonnel(base.name, stages[si].name),
            completedAt,
            sortOrder: si,
          },
        });
      }

      totalOrders++;
    }

    console.log(`  ${base.name} (${base.dataSource}): ${orderCount} orders, ${stages.length} stages`);
  }

  console.log(`\nCreated ${totalOrders} orders total across ${bases.length} bases.`);
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
