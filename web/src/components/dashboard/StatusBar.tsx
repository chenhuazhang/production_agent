interface StatusBarProps {
  notStarted: number;
  inProgress: number;
  completed: number;
  total: number;
}

export function StatusBar({ notStarted, inProgress, completed, total }: StatusBarProps) {
  if (total === 0) {
    return (
      <div className="w-full bg-gray-200 rounded-full h-2.5" />
    );
  }

  const notStartedPct = Math.max((notStarted / total) * 100, 0);
  const inProgressPct = Math.max((inProgress / total) * 100, 0);
  const completedPct = Math.max((completed / total) * 100, 0);

  return (
    <div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden flex">
        {notStartedPct > 0 && (
          <div
            className="h-full bg-gray-400 transition-all"
            style={{ width: `${notStartedPct}%` }}
            title={`待开始: ${notStarted}`}
          />
        )}
        {inProgressPct > 0 && (
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${inProgressPct}%` }}
            title={`生产中: ${inProgress}`}
          />
        )}
        {completedPct > 0 && (
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${completedPct}%` }}
            title={`已完成: ${completed}`}
          />
        )}
      </div>
      <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
          待开始 {notStarted}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
          生产中 {inProgress}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          已完成 {completed}
        </span>
      </div>
    </div>
  );
}
