"use client";

import { useEffect, useState } from "react";
import { DashboardKpiCards } from "@/components/dashboard/DashboardKpiCards";
import { BaseOrderCard } from "@/components/dashboard/BaseOrderCard";
import { DeliveryWarnings } from "@/components/dashboard/DeliveryWarnings";

interface DashboardData {
  summary: {
    totalOrders: number;
    pendingCount: number;
    inProgressCount: number;
    completedCount: number;
    overdueCount: number;
    warningCount: number;
    totalExtrusionExceptions: number;
    totalStripExceptions: number;
    totalColorPlateExceptions: number;
  };
  bases: BaseData[];
  warnings: WarningOrder[];
}

interface ProcessStageItem {
  stageName: string;
  count: number;
}

interface RecentOrder {
  orderNo: string;
  productName: string;
  customerName: string;
  machine: string | null;
  orderCount: number;
  status: string;
  priority: string;
  plannedDate: string;
  currentStage: string | null;
  extrusionException: boolean;
  injectionStripException: boolean;
  injectionColorPlateException: boolean;
}

interface BaseData {
  id: string;
  name: string;
  location: string;
  dataSource: string;
  orderCount: number;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  loadRate: number;
  dailyCapacity: number;
  pendingOrders: number;
  overloadMultiplier: number;
  daysToComplete: number;
  urgentCount: number;
  overdueCount: number;
  warningCount: number;
  extrusionExceptions: number;
  injectionStripExceptions: number;
  injectionColorPlateExceptions: number;
  hasProcessData: boolean;
  processDistribution: ProcessStageItem[];
  recentOrders: RecentOrder[];
}

interface WarningOrder {
  orderNo: string;
  productName: string;
  baseName: string;
  plannedDate: string;
  daysOverdue: number;
  status: string;
  currentStage: string | null;
  machine: string | null;
  extrusionException: boolean;
  injectionStripException: boolean;
  injectionColorPlateException: boolean;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch dashboard data");
        return res.json();
      })
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#faf8f5]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8b7fc7] mx-auto mb-3" />
          <p className="text-[#8a8599]">加载生产数据中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#faf8f5]">
        <div className="text-center">
          <p className="text-red-500 mb-2">加载失败</p>
          <p className="text-sm text-[#8a8599]">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { summary, bases, warnings } = data;

  return (
    <div className="flex-1 p-8 overflow-auto bg-[#faf8f5]">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a2e]">生产执行看板</h1>
            <p className="text-sm text-[#8a8599] mt-1">
              五大基地生产状态总览 — 订单进度、工序分布、异常预警一屏看全局
            </p>
          </div>
        </div>

        {/* KPI summary cards */}
        <div className="mb-6">
          <DashboardKpiCards
            totalOrders={summary.totalOrders}
            pendingCount={summary.pendingCount}
            inProgressCount={summary.inProgressCount}
            completedCount={summary.completedCount}
            overdueCount={summary.overdueCount}
            warningCount={summary.warningCount}
            totalExtrusionExceptions={summary.totalExtrusionExceptions}
            totalStripExceptions={summary.totalStripExceptions}
            totalColorPlateExceptions={summary.totalColorPlateExceptions}
          />
        </div>

        {/* Global delivery warnings */}
        {warnings.length > 0 && (
          <div className="mb-6">
            <DeliveryWarnings warnings={warnings} />
          </div>
        )}

        {/* Per-base detail cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bases.map((base) => (
            <BaseOrderCard
              key={base.id}
              name={base.name}
              location={base.location}
              dataSource={base.dataSource}
              orderCount={base.orderCount}
              pendingCount={base.pendingCount}
              inProgressCount={base.inProgressCount}
              completedCount={base.completedCount}
              loadRate={base.loadRate}
              dailyCapacity={base.dailyCapacity}
              overloadMultiplier={base.overloadMultiplier}
              daysToComplete={base.daysToComplete}
              urgentCount={base.urgentCount}
              overdueCount={base.overdueCount}
              warningCount={base.warningCount}
              extrusionExceptions={base.extrusionExceptions}
              injectionStripExceptions={base.injectionStripExceptions}
              injectionColorPlateExceptions={base.injectionColorPlateExceptions}
              hasProcessData={base.hasProcessData}
              processDistribution={base.processDistribution}
              recentOrders={base.recentOrders}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
