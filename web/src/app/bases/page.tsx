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
        <p className="text-[#8a8599]">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-auto bg-[#faf8f5]">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-[#1a1a2e]">基地管理</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((base) => {
            const dailyCapacity = base.machineCount * base.perMachineDailyOutput;
            return (
              <Card key={base.id} className="border-[#e8e4dd] bg-white hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-[#1a1a2e]">{base.name}</CardTitle>
                    <Badge variant={base.active ? "default" : "secondary"} className={base.active ? "bg-[#7c9a6b]" : ""}>
                      {base.active ? "运行中" : "停用"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#8a8599]">位置</span>
                      <span className="text-[#4a4a5a]">{base.location}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a8599]">设备台数</span>
                      <span className="text-[#4a4a5a]">{base.machineCount} 台</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a8599]">单台日产量</span>
                      <span className="text-[#4a4a5a]">{base.perMachineDailyOutput} 单/天</span>
                    </div>
                    <div className="flex justify-between border-t border-[#e8e4dd] pt-2 mt-2">
                      <span className="font-medium text-[#1a1a2e]">日产能定额</span>
                      <span className="font-bold text-[#8b7fc7]">{dailyCapacity} 单/天</span>
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
