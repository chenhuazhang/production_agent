import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, AlertCircle } from "lucide-react";

interface WarningOrder {
  orderNo: string;
  productName: string;
  baseName: string;
  plannedDate: string;
  daysOverdue: number; // positive = overdue, negative = days remaining
  status: string;
  currentStage: string | null;
  machine: string | null;
  extrusionException: boolean;
  injectionStripException: boolean;
  injectionColorPlateException: boolean;
}

interface DeliveryWarningsProps {
  warnings: WarningOrder[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function DeliveryWarnings({ warnings }: DeliveryWarningsProps) {
  if (warnings.length === 0) {
    return null;
  }

  const overdueOrders = warnings.filter((w) => w.daysOverdue > 0);
  const dueSoonOrders = warnings.filter((w) => w.daysOverdue <= 0);
  const hasOverdue = overdueOrders.length > 0;

  return (
    <Card className={hasOverdue ? "border-red-300" : "border-amber-300"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className={`h-5 w-5 ${hasOverdue ? "text-red-500" : "text-amber-500"}`} />
          交期预警
          {hasOverdue && (
            <Badge className="bg-red-100 text-red-600 border-0 text-xs">
              {overdueOrders.length} 单逾期
            </Badge>
          )}
          {dueSoonOrders.length > 0 && (
            <Badge className="bg-amber-100 text-amber-600 border-0 text-xs">
              {dueSoonOrders.length} 单临期
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b">
                <th className="text-left py-2 pr-3">订单号</th>
                <th className="text-left py-2 pr-3">产品</th>
                <th className="text-left py-2 pr-3">基地</th>
                <th className="text-left py-2 pr-3">机台</th>
                <th className="text-left py-2 pr-3">当前工序</th>
                <th className="text-left py-2 pr-3">计划交期</th>
                <th className="text-left py-2 pr-3">状态</th>
                <th className="text-right py-2">预警</th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((order) => {
                const isOverdue = order.daysOverdue > 0;
                const hasException = order.extrusionException || order.injectionStripException || order.injectionColorPlateException;
                const uniqueKey = `${order.orderNo}-${order.baseName}`;
                return (
                  <tr
                    key={uniqueKey}
                    className={`border-b border-gray-50 ${
                      isOverdue ? "bg-red-50/50" : "bg-amber-50/30"
                    }`}
                  >
                    <td className="py-2 pr-3 font-mono text-gray-700">
                      {hasException && <AlertCircle className="h-3 w-3 inline text-orange-500 mr-1" />}
                      {order.orderNo}
                    </td>
                    <td className="py-2 pr-3 truncate max-w-[100px]" title={order.productName}>
                      {order.productName}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{order.baseName}</td>
                    <td className="py-2 pr-3 text-gray-500 font-mono text-xs">{order.machine || "-"}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{order.currentStage || "-"}</td>
                    <td className="py-2 pr-3 text-gray-600">{formatDate(order.plannedDate)}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        className={`text-xs border-0 ${
                          order.status === "in_progress"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {order.status === "in_progress" ? "生产中" : "待开始"}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">
                      {isOverdue ? (
                        <span className="text-red-600 font-bold text-xs flex items-center justify-end gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          逾期 {order.daysOverdue} 天
                        </span>
                      ) : (
                        <span className="text-amber-600 font-medium text-xs flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />
                          剩余 {Math.abs(order.daysOverdue)} 天
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
