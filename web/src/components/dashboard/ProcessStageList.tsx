interface ProcessStageItem {
  stageName: string;
  count: number;
}

interface ProcessStageListProps {
  stages: ProcessStageItem[];
}

export function ProcessStageList({ stages }: ProcessStageListProps) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  const hasAny = stages.some((s) => s.count > 0);

  if (!hasAny) {
    return <p className="text-xs text-[#b5b0c4]">暂无工序数据</p>;
  }

  return (
    <div className="space-y-1">
      {stages
        .filter((s) => s.count > 0)
        .map((stage) => (
          <div key={stage.stageName} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-[#8a8599] shrink-0">{stage.stageName}</span>
            <div className="flex-1 bg-[#f5f2ed] rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-[#8b7fc7] rounded-full transition-all"
                style={{ width: `${Math.max((stage.count / maxCount) * 100, 8)}%` }}
              />
            </div>
            <span className="w-6 text-right text-[#6b6b7b] font-medium">{stage.count}</span>
          </div>
        ))}
    </div>
  );
}
