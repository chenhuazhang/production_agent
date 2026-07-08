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
    <Card className="my-2 border-dashed border-[#d4c9e8] bg-[#faf8f5]">
      <CardContent className="p-3 text-sm">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={success ? "secondary" : "destructive"} className="text-xs bg-[#f0ebf7] text-[#8b7fc7] border-0">
            {label}
          </Badge>
          {success ? (
            <span className="text-xs text-[#7c9a6b]">执行成功</span>
          ) : (
            <span className="text-xs text-red-600">执行失败</span>
          )}
        </div>
        {data?.error && (
          <p className="text-red-500 text-xs">{data.error}</p>
        )}
        {!!data?.result && (
          <pre className="text-xs bg-[#f5f2ed] p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap border border-[#e8e4dd]">
            {JSON.stringify(data.result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
