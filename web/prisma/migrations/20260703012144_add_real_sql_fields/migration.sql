/*
  Warnings:

  - You are about to drop the column `completed_count` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `quantity_kg` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `responsible_person` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `stage_count` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `planned_date` on the `process_stages` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "data_source" TEXT NOT NULL DEFAULT '小试',
    "machine_count" INTEGER NOT NULL,
    "per_machine_daily_output" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_bases" ("active", "created_at", "id", "location", "machine_count", "name", "per_machine_daily_output", "updated_at") SELECT "active", "created_at", "id", "location", "machine_count", "name", "per_machine_daily_output", "updated_at" FROM "bases";
DROP TABLE "bases";
ALTER TABLE "new_bases" RENAME TO "bases";
CREATE TABLE "new_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "machine" TEXT,
    "order_count" REAL NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "delivery_date" DATETIME NOT NULL,
    "current_stage" TEXT,
    "extrusion_exception" BOOLEAN NOT NULL DEFAULT false,
    "injection_strip_exception" BOOLEAN NOT NULL DEFAULT false,
    "injection_color_plate_exception" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "orders_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_orders" ("base_id", "created_at", "current_stage", "customer_name", "delivery_date", "id", "order_number", "priority", "product_name", "status", "updated_at") SELECT "base_id", "created_at", "current_stage", "customer_name", "delivery_date", "id", "order_number", "priority", "product_name", "status", "updated_at" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE TABLE "new_process_stages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "person" TEXT,
    "completed_at" DATETIME,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "process_stages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_process_stages" ("completed_at", "id", "name", "order_id", "person", "sort_order", "status") SELECT "completed_at", "id", "name", "order_id", "person", "sort_order", "status" FROM "process_stages";
DROP TABLE "process_stages";
ALTER TABLE "new_process_stages" RENAME TO "process_stages";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
