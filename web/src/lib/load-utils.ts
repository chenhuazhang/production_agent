// Shared color utility functions for load rate visualization.
// Used by both CapacityChart and the production dashboard components.
// Extracted from CapacityChart.tsx to avoid duplication.

export function getLoadColor(loadRate: number): string {
  if (loadRate >= 100) return "text-red-600";
  if (loadRate >= 70) return "text-orange-500";
  if (loadRate >= 40) return "text-yellow-600";
  return "text-green-600";
}

export function getLoadBg(loadRate: number): string {
  if (loadRate >= 100) return "bg-red-100";
  if (loadRate >= 70) return "bg-orange-100";
  if (loadRate >= 40) return "bg-yellow-100";
  return "bg-green-100";
}

export function getLoadLabel(loadRate: number): string {
  if (loadRate >= 100) return "超负荷";
  if (loadRate >= 70) return "较高";
  if (loadRate >= 40) return "适中";
  return "空闲";
}

export function getLoadBarColor(loadRate: number): string {
  if (loadRate >= 100) return "bg-red-500";
  if (loadRate >= 70) return "bg-orange-400";
  if (loadRate >= 40) return "bg-yellow-400";
  return "bg-green-400";
}
