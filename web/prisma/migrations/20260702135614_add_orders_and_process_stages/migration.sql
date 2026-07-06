-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "quantity_kg" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "delivery_date" DATETIME NOT NULL,
    "current_stage" TEXT,
    "responsible_person" TEXT,
    "stage_count" INTEGER NOT NULL DEFAULT 0,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "orders_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "process_stages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "person" TEXT,
    "planned_date" DATETIME,
    "completed_at" DATETIME,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "process_stages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
