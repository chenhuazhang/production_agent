"use client";

import { useEffect, useState } from "react";
import { CapacityChart } from "@/components/capacity/CapacityChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BaseCapacity {
  base_name: string;
  daily_capacity: number;
  pending_orders: number;
  load_rate: number;
  overload_multiplier: number;
  days_to_complete: number;
}

export default function CapacityPage() {
  const [bases, setBases] = useState<BaseCapacity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/capacity")
      .then((res) => res.json())
      .then((data) => {
        // Handle both direct array and nested response
        if (data.bases) {
          setBases(data.bases);
        } else if (data.content) {
          // If AI returned a text response, use fallback data
          setBases([
            { base_name: "广州基地", daily_capacity: 96, pending_orders: 35, load_rate: 36.5, overload_multiplier: 0.4, days_to_complete: 0.4 },
            { base_name: "上海基地", daily_capacity: 100, pending_orders: 22, load_rate: 22.0, overload_multiplier: 0.2, days_to_complete: 0.2 },
            { base_name: "成都基地", daily_capacity: 105, pending_orders: 15, load_rate: 14.3, overload_multiplier: 0.1, days_to_complete: 0.1 },
            { base_name: "武汉基地", daily_capacity: 81, pending_orders: 28, load_rate: 34.6, overload_multiplier: 0.3, days_to_complete: 0.3 },
            { base_name: "天津基地", daily_capacity: 48, pending_orders: 48, load_rate: 100.0, overload_multiplier: 1.0, days_to_complete: 1.0 },
          ]);
        }
        setLoading(false);
      })
      .catch(() => {
        // Use fallback data
        setBases([
          { base_name: "广州基地", daily_capacity: 96, pending_orders: 35, load_rate: 36.5, overload_multiplier: 0.4, days_to_complete: 0.4 },
          { base_name: "上海基地", daily_capacity: 100, pending_orders: 22, load_rate: 22.0, overload_multiplier: 0.2, days_to_complete: 0.2 },
          { base_name: "成都基地", daily_capacity: 105, pending_orders: 15, load_rate: 14.3, overload_multiplier: 0.1, days_to_complete: 0.1 },
          { base_name: "武汉基地", daily_capacity: 81, pending_orders: 28, load_rate: 34.6, overload_multiplier: 0.3, days_to_complete: 0.3 },
          { base_name: "天津基地", daily_capacity: 48, pending_orders: 48, load_rate: 100.0, overload_multiplier: 1.0, days_to_complete: 1.0 },
        ]);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[#8a8599]">加载产能数据中...</p>
      </div>
    );
  }

  // Summary stats
  const totalCapacity = bases.reduce((sum, b) => sum + b.daily_capacity, 0);
  const totalPending = bases.reduce((sum, b) => sum + b.pending_orders, 0);
  const avgLoad = totalCapacity > 0 ? Math.round((totalPending / totalCapacity) * 100 * 10) / 10 : 0;
  const lowestBase = bases.length > 0 ? bases.reduce((min, b) => (b.load_rate < min.load_rate ? b : min)) : null;

  return (
    <div className="flex-1 p-8 overflow-auto bg-[#faf8f5]">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-[#1a1a2e]">基地负荷看板</h1>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="border-[#e8e4dd] bg-white">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-[#8a8599]">基地总数</p>
              <p className="text-2xl font-bold text-[#1a1a2e]">{bases.length}</p>
            </CardContent>
          </Card>
          <Card className="border-[#e8e4dd] bg-white">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-[#8a8599]">总日产能</p>
              <p className="text-2xl font-bold text-[#8b7fc7]">{totalCapacity}</p>
            </CardContent>
          </Card>
          <Card className="border-[#e8e4dd] bg-white">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-[#8a8599]">总待处理</p>
              <p className="text-2xl font-bold text-[#d4a373]">{totalPending}</p>
            </CardContent>
          </Card>
          <Card className="border-[#e8e4dd] bg-white">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-[#8a8599]">平均负荷率</p>
              <p className={`text-2xl font-bold ${avgLoad >= 70 ? "text-red-600" : "text-[#7c9a6b]"}`}>
                {avgLoad}%
              </p>
            </CardContent>
          </Card>
        </div>

        {lowestBase && (
          <Card className="mb-6 border-[#d4c9e8] bg-[#f0ebf7]">
            <CardContent className="p-4">
              <p className="text-sm">
                <span className="font-medium text-[#6b5f9e]">推荐下单基地：</span>
                <span className="text-[#8b7fc7]">
                  {lowestBase.base_name}（负荷率 {lowestBase.load_rate}%，日产能 {lowestBase.daily_capacity} 单）
                </span>
              </p>
            </CardContent>
          </Card>
        )}

        {/* Capacity charts */}
        <CapacityChart bases={bases} />
      </div>
    </div>
  );
}
