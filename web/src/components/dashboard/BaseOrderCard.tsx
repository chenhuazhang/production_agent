import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBar } from "./StatusBar";
import { ProcessStageList } from "./ProcessStageList";
import { getLoadColor, getLoadBg, getLoadLabel, getLoadBarColor } from "@/lib/load-utils";
import { AlertTriangle, Zap, Wrench, AlertCircle } from "lucide-react";

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

interface ProcessStageItem {
  stageName: string;
  count: number;
}

interface BaseOrderCardProps {
  name: string;
  location: string;
  dataSource: string;
  orderCount: number;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  loadRate: number;
  dailyCapacity: number;
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isOverdue(iso: string): boolean {
  return new Date(iso) < new Date();
}

function isDueSoon(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  return diff >= 0 && diff < 2 * 86400000;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "not_started":
      return <Badge variant="secondary" className="text-xs">待开始</Badge>;
    case "in_progress":
      return <Badge className="text-xs bg-blue-100 text-blue-700 border-0">生产中</Badge>;
    case "completed":
      return <Badge className="text-xs bg-green-100 text-green-700 border-0">已完成</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

export function BaseOrderCard({
  name,
  location,
  dataSource,
  orderCount,
  pendingCount,
  inProgressCount,
  completedCount,
  loadRate,
  dailyCapacity,
  overloadMultiplier,
  daysToComplete,
  urgentCount,
  overdueCount,
  warningCount,
  extrusionExceptions,
  injectionStripExceptions,
  injectionColorPlateExceptions,
  hasProcessData,
  processDistribution,
  recentOrders,
}: BaseOrderCardProps) {
  const totalExceptions = extrusionExceptions + injectionStripExceptions + injectionColorPlateExceptions;

  return (
    <Card className="border-[#e8e4dd] bg-white hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base text-[#1a1a2e]">{name}</CardTitle>
            <Badge variant="outline" className="text-xs font-normal text-[#8a8599] border-[#e8e4dd]">
              {dataSource}
            </Badge>
            <span className="text-xs text-[#b5b0c4]">{location}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {urgentCount > 0 && (
              <Badge className="text-xs bg-red-100 text-red-600 border-0">
                <Zap className="h-3 w-3 mr-0.5" />
                {urgentCount}急单
              </Badge>
            )}
            {totalExceptions > 0 && (
              <Badge className="text-xs bg-orange-100 text-orange-600 border-0">
                <AlertCircle className="h-3 w-3 mr-0.5" />
                {totalExceptions}异常
              </Badge>
            )}
            {(overdueCount > 0 || warningCount > 0) && (
              <Badge className={`text-xs border-0 ${
                overdueCount > 0 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
              }`}>
                <AlertTriangle className="h-3 w-3 mr-0.5" />
                {overdueCount > 0 ? `${overdueCount}逾期` : `${warningCount}临期`}
              </Badge>
            )}
            <Badge className={`${getLoadBg(loadRate)} ${getLoadColor(loadRate)} border-0 text-xs`}>
              {getLoadLabel(loadRate)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Load rate bar */}
        <div>
          <div className="flex justify-between text-xs text-[#8a8599] mb-1">
            <span>负荷率</span>
            <span className={`font-bold ${getLoadColor(loadRate)}`}>{loadRate}%</span>
          </div>
          <div className="w-full bg-[#e8e4dd] rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all ${getLoadBarColor(loadRate)}`}
              style={{ width: `${Math.min(loadRate, 100)}%` }}
            />
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="text-center">
            <p className="text-[#8a8599]">订单</p>
            <p className="font-bold text-[#8b7fc7]">{orderCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[#8a8599]">日产能</p>
            <p className="font-bold text-[#1a1a2e]">{dailyCapacity}单</p>
          </div>
          <div className="text-center">
            <p className="text-[#8a8599]">负荷倍数</p>
            <p className={`font-bold ${getLoadColor(loadRate)}`}>{overloadMultiplier}x</p>
          </div>
          <div className="text-center">
            <p className="text-[#8a8599]">完工天数</p>
            <p className="font-bold text-[#1a1a2e]">{daysToComplete}天</p>
          </div>
        </div>

        {/* Exception breakdown if any */}
        {totalExceptions > 0 && (
          <div className="flex gap-3 text-xs">
            {extrusionExceptions > 0 && (
              <span className="text-orange-600 flex items-center gap-1">
                <Wrench className="h-3 w-3" /> 挤出异常 {extrusionExceptions}
              </span>
            )}
            {injectionStripExceptions > 0 && (
              <span className="text-orange-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> 注塑样条异常 {injectionStripExceptions}
              </span>
            )}
            {injectionColorPlateExceptions > 0 && (
              <span className="text-orange-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> 注塑色板异常 {injectionColorPlateExceptions}
              </span>
            )}
          </div>
        )}

        {/* Status distribution bar */}
        <StatusBar
          notStarted={pendingCount}
          inProgress={inProgressCount}
          completed={completedCount}
          total={orderCount}
        />

        {/* Process stage distribution */}
        {processDistribution.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[#8a8599] mb-1.5">
              工序分布
              {!hasProcessData && (
                <span className="text-[#b5b0c4] ml-1">
                  （{dataSource === "小试" ? "6道工序" : dataSource === "OA辅助单" ? "简化流程" : ""}）
                </span>
              )}
            </p>
            <ProcessStageList stages={processDistribution} />
          </div>
        )}

        {/* Recent orders table */}
        {recentOrders.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[#8a8599] mb-1.5">活跃订单</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#b5b0c4] border-b border-[#e8e4dd]">
                    <th className="text-left py-1 pr-2">单号</th>
                    <th className="text-left py-1 pr-2">产品</th>
                    <th className="text-left py-1 pr-2">机台</th>
                    <th className="text-left py-1 pr-2">工序</th>
                    <th className="text-left py-1 pr-2">交期</th>
                    <th className="text-left py-1">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o, idx) => {
                    const hasAnyEx = o.extrusionException || o.injectionStripException || o.injectionColorPlateException;
                    return (
                      <tr key={`${o.orderNo}-${o.machine || ''}-${idx}`} className="border-b border-[#f5f2ed]">
                        <td className="py-1 pr-2 font-mono text-[#6b6b7b]">
                          {o.priority === "urgent" && <Zap className="h-3 w-3 inline text-red-500 mr-0.5" />}
                          {hasAnyEx && <AlertCircle className="h-3 w-3 inline text-[#d4a373] mr-0.5" />}
                          {o.orderNo}
                        </td>
                        <td className="py-1 pr-2 truncate max-w-[80px] text-[#4a4a5a]" title={o.productName}>
                          {o.productName}
                        </td>
                        <td className="py-1 pr-2 text-[#8a8599] font-mono">
                          {o.machine || "-"}
                        </td>
                        <td className="py-1 pr-2 truncate max-w-[60px] text-[#4a4a5a]" title={o.currentStage ?? ""}>
                          {o.currentStage || "-"}
                        </td>
                        <td className={`py-1 pr-2 ${
                          isOverdue(o.plannedDate) ? "text-red-600 font-bold" :
                          isDueSoon(o.plannedDate) ? "text-[#d4a373] font-medium" :
                          "text-[#8a8599]"
                        }`}>
                          {formatDate(o.plannedDate)}
                          {isOverdue(o.plannedDate) && " ⚠"}
                        </td>
                        <td className="py-1">{getStatusBadge(o.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
