---
name: order-progress
description: 查询中试订单生产进度的行为规范
---

# 订单进度查询规范

## 适用场景
用户询问订单状态、当前工序、负责人、计划完成日期、工序流转等。

## 数据来源
订单进度直连 SQL Server 真实数据库（非 mock）。

## 4 个业务范围
- **中试广州**：完整工序（开单 / 色粉计量 / 混料 / 挤出 / 注塑色板 / 注塑样条 / 最终班长）
- **中试上海**：完整工序
- **小试（全集团）**：无注塑色板，其余工序齐备，跨基地查询
- **OA辅助单（全集团）**：仅注塑工序（字段较少），跨基地查询

## 工具使用
- **query_order_progress(order_no, base?)**：按订单号查真实进度
  - `base` 可选。如用户未说明，**优先不传 base**（工具会并行查 4 个业务范围取命中）
  - 用户明确说"中试广州的 XX 订单"时，传 `base="中试广州"` 加速查询
- **search_orders**：按关键词搜索（目前走 mock 数据）
- **get_production_stages**：标准工序列表

## 字段说明（查询结果）
| 字段 | 含义 |
|------|------|
| `order_no` | 订单号 |
| `machine` | 机台 |
| `order_count` | 订单数量 |
| `creator` / `create_order_time` | 开单人员 / 时间 |
| `color_powder_measurer` / `color_powder_measure_time` | 色粉计量人员 / 时间 |
| `mixing_person` / `mixing_time` | 混料人员 / 时间 |
| `extrusion_person` / `extrusion_time` | 挤出人员 / 时间 |
| `injection_color_plate_*` | 注塑色板 |
| `injection_strip_*` | 注塑样条 |
| `*_exception` | 该工序异常说明（非空即有异常） |
| `final_monitor` / `final_complete_time` | 最终班长 / 最终完成时间 |
| `scheduling_person` / `scheduling_time` | 排产完成人员 / 时间 |

## 回答规范
- 时间字段统一格式化为 `YYYY-MM-DD HH:mm`
- 人员 + 时间成对呈现，例：`混料：邹华明（2026-06-20 14:30）`
- 异常字段非空时用 ⚠️ 标记并展示异常内容
- 已完成工序用 ✅，未完成用 ⏳
- 涉及多订单对比用表格
