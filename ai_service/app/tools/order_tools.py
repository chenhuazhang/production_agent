"""Order-related AI tools."""

from typing import Any
from app.adapters.mock_adapter import get_adapter
from app.tools.registry import register_tool


async def query_order_progress(order_no: str) -> dict[str, Any]:
    """Query the production progress of a specific order."""
    adapter = get_adapter()
    order = await adapter.get_order_by_no(order_no)
    if not order:
        return {"error": f"未找到订单 {order_no}"}
    
    stages = await adapter.get_order_stages(order_no)
    return {
        "order": order,
        "stages": stages,
        "current_stage": order["current_stage"],
        "stage_status": order["stage_status"],
    }


async def search_orders(keyword: str) -> dict[str, Any]:
    """Search orders by keyword (order number, customer, product name)."""
    adapter = get_adapter()
    results = await adapter.search_orders(keyword)
    if not results:
        return {"message": f"未找到与 '{keyword}' 相关的订单", "orders": []}
    return {"message": f"找到 {len(results)} 条相关订单", "orders": results}


async def get_production_stages() -> dict[str, Any]:
    """Get the standard production workflow stages."""
    from app.adapters.mock_adapter import PRODUCTION_STAGES
    return {
        "stages": PRODUCTION_STAGES,
        "description": "订单从下单到入库的标准生产流程",
    }


def register_order_tools():
    """Register all order-related tools."""
    
    register_tool(
        name="query_order_progress",
        description="查询指定订单的生产进度，包括当前工序、负责人、计划日期等详细信息",
        parameters={
            "type": "object",
            "properties": {
                "order_no": {
                    "type": "string",
                    "description": "订单编号，例如 ZS-2026-001",
                },
            },
            "required": ["order_no"],
        },
        func=query_order_progress,
    )
    
    register_tool(
        name="search_orders",
        description="搜索订单，支持按订单号、客户名、产品名称搜索",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {
                    "type": "string",
                    "description": "搜索关键词，可以是订单号、客户名称或产品名称",
                },
            },
            "required": ["keyword"],
        },
        func=search_orders,
    )
    
    register_tool(
        name="get_production_stages",
        description="获取中试订单的标准生产流程工序列表",
        parameters={
            "type": "object",
            "properties": {},
        },
        func=get_production_stages,
    )
