import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, BarChart3, Settings } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-[#faf8f5]">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 text-[#1a1a2e]">中试 AI 助手</h1>
          <p className="text-[#8a8599]">
            集团五大中试基地智能管理平台 — 订单进度查询 & 产能负荷分析
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-[#e8e4dd] bg-white hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#1a1a2e]">
                <MessageSquare className="h-5 w-5 text-[#8b7fc7]" />
                智能对话
              </CardTitle>
              <CardDescription className="text-[#8a8599]">
                通过自然语言查询订单进度、分析产能负荷、获取下单推荐
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/chat">
                <Button className="w-full bg-[#8b7fc7] hover:bg-[#6b5f9e]">开始对话</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="border-[#e8e4dd] bg-white hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#1a1a2e]">
                <BarChart3 className="h-5 w-5 text-[#7c9a6b]" />
                负荷看板
              </CardTitle>
              <CardDescription className="text-[#8a8599]">
                可视化查看五大基地的产能负荷率、超负荷倍数等指标
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/capacity">
                <Button variant="outline" className="w-full border-[#e8e4dd] text-[#4a4a5a]">查看看板</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="border-[#e8e4dd] bg-white hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[#1a1a2e]">
                <Settings className="h-5 w-5 text-[#b5b0c4]" />
                基地管理
              </CardTitle>
              <CardDescription className="text-[#8a8599]">
                管理基地基础信息，包括设备台数、单台日标准产量等参数
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/bases">
                <Button variant="outline" className="w-full border-[#e8e4dd] text-[#4a4a5a]">管理基地</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
