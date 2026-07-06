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
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <ClipboardList className="h-8 w-8 text-blue-500 shrink-0" />
          <div>
            <p className="text-xs text-gray-500">订单总数</p>
            <p className="text-2xl font-bold text-blue-600">{totalOrders}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <Clock className="h-8 w-8 text-gray-400 shrink-0" />
          <div>
            <p className="text-xs text-gray-500">待开始</p>
            <p className="text-2xl font-bold text-gray-600">{pendingCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <PlayCircle className="h-8 w-8 text-amber-500 shrink-0" />
          <div>
            <p className="text-xs text-gray-500">生产中</p>
            <p className="text-2xl font-bold text-amber-600">{inProgressCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
          <div>
            <p className="text-xs text-gray-500">已完成</p>
            <p className="text-2xl font-bold text-green-600">{completedCount}</p>
          </div>
        </CardContent>
      </Card>

      <Card className={overdueCount > 0 ? "border-red-300 bg-red-50" : warningCount > 0 ? "border-amber-300 bg-amber-50" : ""}>
        <CardContent className="p-4 flex items-center gap-3">
          <AlertTriangle
            className={`h-8 w-8 shrink-0 ${
              overdueCount > 0 ? "text-red-500" : warningCount > 0 ? "text-amber-500" : "text-gray-400"
            }`}
          />
          <div>
            <p className="text-xs text-gray-500">交期预警</p>
            <p className={`text-2xl font-bold ${
              overdueCount > 0 ? "text-red-600" : warningCount > 0 ? "text-amber-600" : "text-gray-400"
            }`}>
              {overdueCount + warningCount}
            </p>
            {(overdueCount > 0 || warningCount > 0) && (
              <p className="text-xs text-gray-500">
                {overdueCount > 0 && <span className="text-red-500">逾期 {overdueCount}</span>}
                {overdueCount > 0 && warningCount > 0 && " "}
                {warningCount > 0 && <span className="text-amber-500">临期 {warningCount}</span>}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {totalExceptions > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-orange-500 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">异常订单</p>
              <p className="text-2xl font-bold text-orange-600">{totalExceptions}</p>
              <p className="text-xs text-gray-500">
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
