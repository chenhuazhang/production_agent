"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Base {
  id: string;
  name: string;
  location: string;
  machineCount: number;
  perMachineDailyOutput: number;
  active: boolean;
}

export default function BasesPage() {
  const [bases, setBases] = useState<Base[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bases")
      .then((res) => res.json())
      .then((data) => {
        setBases(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">基地管理</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((base) => {
            const dailyCapacity = base.machineCount * base.perMachineDailyOutput;
            return (
              <Card key={base.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{base.name}</CardTitle>
                    <Badge variant={base.active ? "default" : "secondary"}>
                      {base.active ? "运行中" : "停用"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">位置</span>
                      <span>{base.location}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">设备台数</span>
                      <span>{base.machineCount} 台</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">单台日产量</span>
                      <span>{base.perMachineDailyOutput} 单/天</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span className="font-medium">日产能定额</span>
                      <span className="font-bold text-blue-600">{dailyCapacity} 单/天</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
