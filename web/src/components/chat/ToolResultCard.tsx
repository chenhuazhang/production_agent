"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface ToolResult {
  tool_call_id: string;
  name: string;
  result: {
    result?: unknown;
    success?: boolean;
    error?: string;
  };
}

const TOOL_LABELS: Record<string, string> = {
  query_order_progress: "查询订单进度",
  search_orders: "搜索订单",
  get_production_stages: "获取生产流程",
  analyze_capacity: "分析产能负荷",
  recommend_base: "推荐下单基地",
  estimate_delivery: "估算交期",
};

export function ToolResultCard({ toolResult }: { toolResult: ToolResult }) {
  const label = TOOL_LABELS[toolResult.name] || toolResult.name;
  const data = toolResult.result;
  const success = data?.success !== false && !data?.error;

  return (
    <Card className="my-2 border-dashed">
      <CardContent className="p-3 text-sm">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={success ? "secondary" : "destructive"} className="text-xs">
            {label}
          </Badge>
          {success ? (
            <span className="text-xs text-green-600">执行成功</span>
          ) : (
            <span className="text-xs text-red-600">执行失败</span>
          )}
        </div>
        {data?.error && (
          <p className="text-red-500 text-xs">{data.error}</p>
        )}
        {!!data?.result && (
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap">
            {JSON.stringify(data.result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
