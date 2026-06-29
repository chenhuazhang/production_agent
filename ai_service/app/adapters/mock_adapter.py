from typing import Any
from app.adapters.base_adapter import BaseAdapter

# Production stages definition
PRODUCTION_STAGES = [
    "待排产", "已排产", "色粉开单", "色粉称量",
    "混料工序", "挤出工序", "颜色确认中", "已入库",
    "质检中", "创建交货单",
]

# Mock orders data
MOCK_ORDERS: list[dict[str, Any]] = [
    {
        "order_no": "ZS-2026-001",
        "product_name": "PC阻燃材料-A01",
        "customer": "华为技术",
        "current_stage": "挤出工序",
        "stage_status": "进行中",
        "planned_date": "2026-06-02",
        "assignee": "张工",
        "base_name": "广州基地",
        "notes": "客户要求加急",
        "stages": [
            {"stage": "待排产", "status": "已完成", "date": "2026-05-20", "operator": "系统"},
            {"stage": "已排产", "status": "已完成", "date": "2026-05-21", "operator": "李主管"},
            {"stage": "色粉开单", "status": "已完成", "date": "2026-05-22", "operator": "王工"},
            {"stage": "色粉称量", "status": "已完成", "date": "2026-05-23", "operator": "赵工"},
            {"stage": "混料工序", "status": "已完成", "date": "2026-05-25", "operator": "钱工"},
            {"stage": "挤出工序", "status": "进行中", "date": "2026-05-28", "operator": "孙工"},
        ],
    },
    {
        "order_no": "ZS-2026-002",
        "product_name": "PA66增强材料-B03",
        "customer": "比亚迪",
        "current_stage": "混料工序",
        "stage_status": "进行中",
        "planned_date": "2026-06-05",
        "assignee": "刘工",
        "base_name": "上海基地",
        "notes": None,
        "stages": [
            {"stage": "待排产", "status": "已完成", "date": "2026-05-22", "operator": "系统"},
            {"stage": "已排产", "status": "已完成", "date": "2026-05-23", "operator": "陈主管"},
            {"stage": "色粉开单", "status": "已完成", "date": "2026-05-24", "operator": "周工"},
            {"stage": "色粉称量", "status": "已完成", "date": "2026-05-26", "operator": "吴工"},
            {"stage": "混料工序", "status": "进行中", "date": "2026-05-28", "operator": "郑工"},
        ],
    },
    {
        "order_no": "ZS-2026-003",
        "product_name": "PP耐候材料-C07",
        "customer": "宁德时代",
        "current_stage": "待排产",
        "stage_status": "等待中",
        "planned_date": "2026-06-10",
        "assignee": None,
        "base_name": "成都基地",
        "notes": "大批量订单，约50吨",
        "stages": [
            {"stage": "待排产", "status": "等待中", "date": "2026-05-27", "operator": "系统"},
        ],
    },
]

# Mock pending orders per base
MOCK_BASE_PENDING: dict[str, int] = {
    "广州基地": 35,
    "上海基地": 22,
    "成都基地": 15,
    "武汉基地": 28,
    "天津基地": 48,
}


class MockAdapter(BaseAdapter):
    """Mock adapter for development - simulates business database."""

    async def get_order_by_no(self, order_no: str) -> dict[str, Any] | None:
        for order in MOCK_ORDERS:
            if order["order_no"] == order_no:
                return {k: v for k, v in order.items() if k != "stages"}
        return None

    async def search_orders(self, keyword: str) -> list[dict[str, Any]]:
        keyword_lower = keyword.lower()
        results = []
        for order in MOCK_ORDERS:
            if (
                keyword_lower in order["order_no"].lower()
                or keyword_lower in order["product_name"].lower()
                or keyword_lower in order["customer"].lower()
            ):
                results.append({k: v for k, v in order.items() if k != "stages"})
        return results

    async def get_order_stages(self, order_no: str) -> list[dict[str, Any]]:
        for order in MOCK_ORDERS:
            if order["order_no"] == order_no:
                return order.get("stages", [])
        return []

    async def get_pending_orders_by_base(self, base_name: str) -> int:
        return MOCK_BASE_PENDING.get(base_name, 0)

    async def get_all_pending_orders_summary(self) -> list[dict[str, Any]]:
        return [
            {"base_name": base, "pending_orders": count}
            for base, count in MOCK_BASE_PENDING.items()
        ]


def get_adapter() -> BaseAdapter:
    """Factory function to get the configured data adapter."""
    return MockAdapter()
