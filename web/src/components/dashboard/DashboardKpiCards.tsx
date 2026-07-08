import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList, PlayCircle, CheckCircle2, AlertTriangle, Clock, AlertCircle } from "lucide-react";

interface DashboardKpiCardsProps {
  totalOrders: number;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  overdueCount: number;
  warningCount: number;
  totalExtrusionExceptions?: number;
  totalStripExceptions?: number;
  totalColorPlateExceptions?: number;
}

export function DashboardKpiCards({
  totalOrders,
  pendingCount,
  inProgressCount,
  completedCount,
  overdueCount,
  warningCount,
  totalExtrusionExceptions = 0,
  totalStripExceptions = 0,
  totalColorPlateExceptions = 0,
}: DashboardKpiCardsProps) {
  const totalExceptions = totalExtrusionExceptions + totalStripExceptions + totalColorPlateExceptions;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <Card className="border-[#e8e4dd] bg-white">
        <CardContent className="p-4 flex items-center gap-3">
          <ClipboardList className="h-8 w-8 text-[#8b7fc7] shrink-0" />
          <div>
            <p className="text-xs text-[#8a8599]">订单总数</p>
            <p className="text-2xl font-bold text-[#8b7fc7]">{totalOrders}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[#e8e4dd] bg-white">
        <CardContent className="p-4 flex items-center gap-3">
          <Clock className="h-8 w-8 text-[#b5b0c4] shrink-0" />
          <div>
            <p className="text-xs text-[#8a8599]">待开始</p>
            <p className="text-2xl font-bold text-[#6b6b7b]">{pendingCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[#e8e4dd] bg-white">
        <CardContent className="p-4 flex items-center gap-3">
          <PlayCircle className="h-8 w-8 text-[#d4a373] shrink-0" />
          <div>
            <p className="text-xs text-[#8a8599]">生产中</p>
            <p className="text-2xl font-bold text-[#c9915c]">{inProgressCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[#e8e4dd] bg-white">
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-[#7c9a6b] shrink-0" />
          <div>
            <p className="text-xs text-[#8a8599]">已完成</p>
            <p className="text-2xl font-bold text-[#7c9a6b]">{completedCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card className={overdueCount > 0 ? "border-red-300 bg-red-50" : warningCount > 0 ? "border-[#d4a373] bg-[#fdf6ed]" : "border-[#e8e4dd] bg-white"}>
        <CardContent className="p-4 flex items-center gap-3">
          <AlertTriangle
            className={`h-8 w-8 shrink-0 ${
              overdueCount > 0 ? "text-red-500" : warningCount > 0 ? "text-[#d4a373]" : "text-[#b5b0c4]"
            }`}
          />
          <div>
            <p className="text-xs text-[#8a8599]">交期预警</p>
            <p className={`text-2xl font-bold ${
              overdueCount > 0 ? "text-red-600" : warningCount > 0 ? "text-[#c9915c]" : "text-[#b5b0c4]"
            }`}>
              {overdueCount + warningCount}
            </p>
            {(overdueCount > 0 || warningCount > 0) && (
              <p className="text-xs text-[#8a8599]">
                {overdueCount > 0 && <span className="text-red-500">逾期 {overdueCount}</span>}
                {overdueCount > 0 && warningCount > 0 && " "}
                {warningCount > 0 && <span className="text-[#d4a373]">临期 {warningCount}</span>}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {totalExceptions > 0 && (
        <Card className="border-[#d4a373] bg-[#fdf6ed]">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-[#d4a373] shrink-0" />
            <div>
              <p className="text-xs text-[#8a8599]">异常订单</p>
              <p className="text-2xl font-bold text-[#c9915c]">{totalExceptions}</p>
              <p className="text-xs text-[#8a8599]">
                {totalExtrusionExceptions > 0 && <span>挤出 {totalExtrusionExceptions}</span>}
                {totalStripExceptions > 0 && <span> 注塑 {totalStripExceptions}</span>}
                {totalColorPlateExceptions > 0 && <span> 色板 {totalColorPlateExceptions}</span>}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
