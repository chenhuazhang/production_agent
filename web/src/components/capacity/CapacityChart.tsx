"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BaseCapacity {
  base_name: string;
  daily_capacity: number;
  pending_orders: number;
  load_rate: number;
  overload_multiplier: number;
  days_to_complete: number;
}

function getLoadColor(loadRate: number): string {
  if (loadRate >= 100) return "text-red-600";
  if (loadRate >= 70) return "text-orange-500";
  if (loadRate >= 40) return "text-yellow-600";
  return "text-green-600";
}

function getLoadBg(loadRate: number): string {
  if (loadRate >= 100) return "bg-red-100";
  if (loadRate >= 70) return "bg-orange-100";
  if (loadRate >= 40) return "bg-yellow-100";
  return "bg-green-100";
}

function getLoadLabel(loadRate: number): string {
  if (loadRate >= 100) return "超负荷";
  if (loadRate >= 70) return "较高";
  if (loadRate >= 40) return "适中";
  return "空闲";
}

export function CapacityChart({ bases }: { bases: BaseCapacity[] }) {
  const maxLoad = Math.max(...bases.map((b) => b.load_rate), 100);

  return (
    <div className="space-y-4">
      {bases.map((base) => (
        <Card key={base.base_name}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{base.base_name}</CardTitle>
              <Badge className={`${getLoadBg(base.load_rate)} ${getLoadColor(base.load_rate)} border-0`}>
                {getLoadLabel(base.load_rate)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {/* Load rate bar */}
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>负荷率</span>
                <span className={`font-bold ${getLoadColor(base.load_rate)}`}>
                  {base.load_rate}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    base.load_rate >= 100
                      ? "bg-red-500"
                      : base.load_rate >= 70
                      ? "bg-orange-400"
                      : base.load_rate >= 40
                      ? "bg-yellow-400"
                      : "bg-green-400"
                  }`}
                  style={{ width: `${Math.min((base.load_rate / maxLoad) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">日产能</span>
                <span className="font-medium">{base.daily_capacity} 单</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">待处理</span>
                <span className="font-medium">{base.pending_orders} 单</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">负荷倍数</span>
                <span className={`font-medium ${getLoadColor(base.load_rate)}`}>
                  {base.overload_multiplier}x
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">完工天数</span>
                <span className="font-medium">{base.days_to_complete} 天</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
