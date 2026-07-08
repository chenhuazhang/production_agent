"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLoadColor, getLoadBg, getLoadLabel, getLoadBarColor } from "@/lib/load-utils";

interface BaseCapacity {
  base_name: string;
  daily_capacity: number;
  pending_orders: number;
  load_rate: number;
  overload_multiplier: number;
  days_to_complete: number;
}

export function CapacityChart({ bases }: { bases: BaseCapacity[] }) {
  const maxLoad = Math.max(...bases.map((b) => b.load_rate), 100);

  return (
    <div className="space-y-4">
      {bases.map((base) => (
        <Card className="border-[#e8e4dd] bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-[#1a1a2e]">{base.base_name}</CardTitle>
              <Badge className={`${getLoadBg(base.load_rate)} ${getLoadColor(base.load_rate)} border-0`}>
                {getLoadLabel(base.load_rate)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {/* Load rate bar */}
            <div className="mb-3">
              <div className="flex justify-between text-xs text-[#8a8599] mb-1">
                <span>负荷率</span>
                <span className={`font-bold ${getLoadColor(base.load_rate)}`}>
                  {base.load_rate}%
                </span>
              </div>
              <div className="w-full bg-[#e8e4dd] rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${getLoadBarColor(base.load_rate)}`}
                  style={{ width: `${Math.min((base.load_rate / maxLoad) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#8a8599]">日产能</span>
                <span className="font-medium text-[#1a1a2e]">{base.daily_capacity} 单</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a8599]">待处理</span>
                <span className="font-medium text-[#1a1a2e]">{base.pending_orders} 单</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a8599]">负荷倍数</span>
                <span className={`font-medium ${getLoadColor(base.load_rate)}`}>
                  {base.overload_multiplier}x
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8a8599]">完工天数</span>
                <span className="font-medium text-[#1a1a2e]">{base.days_to_complete} 天</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
