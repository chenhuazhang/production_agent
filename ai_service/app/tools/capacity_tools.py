"""Capacity analysis AI tools."""

from typing import Any
from app.adapters.mock_adapter import get_adapter, MOCK_BASE_PENDING
from app.services.analysis_service import (
    analyze_base_capacity,
    recommend_base,
    estimate_delivery,
)
from app.tools.registry import register_tool

# Base configuration (in production, this comes from the app database)
BASE_CONFIGS = [
    {"name": "广州基地", "location": "广东广州", "machine_count": 12, "per_machine_daily_output": 8},
    {"name": "上海基地", "location": "上海", "machine_count": 10, "per_machine_daily_output": 10},
    {"name": "成都基地", "location": "四川成都", "machine_count": 15, "per_machine_daily_output": 7},
    {"name": "武汉基地", "location": "湖北武汉", "machine_count": 9, "per_machine_daily_output": 9},
    {"name": "天津基地", "location": "天津", "machine_count": 8, "per_machine_daily_output": 6},
]


async def analyze_capacity(base_name: str | None = None) -> dict[str, Any]:
    """Analyze capacity load for one or all bases."""
    adapter = get_adapter()
    
    if base_name:
        # Analyze specific base
        config = next((c for c in BASE_CONFIGS if c["name"] == base_name), None)
        if not config:
            return {"error": f"未找到基地: {base_name}"}
        pending = await adapter.get_pending_orders_by_base(base_name)
        result = analyze_base_capacity(
            base_name=config["name"],
            location=config["location"],
            machine_count=config["machine_count"],
            per_machine_daily_output=config["per_machine_daily_output"],
            pending_orders=pending,
        )
        return {"base": result}
    
    # Analyze all bases
    results = []
    for config in BASE_CONFIGS:
        pending = await adapter.get_pending_orders_by_base(config["name"])
        result = analyze_base_capacity(
            base_name=config["name"],
            location=config["location"],
            machine_count=config["machine_count"],
            per_machine_daily_output=config["per_machine_daily_output"],
            pending_orders=pending,
        )
        results.append(result)
    
    return {"bases": results, "total_bases": len(results)}


async def recommend_base_tool() -> dict[str, Any]:
    """Recommend the best base for a new order based on current load."""
    adapter = get_adapter()
    
    bases_data = []
    for config in BASE_CONFIGS:
        pending = await adapter.get_pending_orders_by_base(config["name"])
        result = analyze_base_capacity(
            base_name=config["name"],
            location=config["location"],
            machine_count=config["machine_count"],
            per_machine_daily_output=config["per_machine_daily_output"],
            pending_orders=pending,
        )
        bases_data.append(result)
    
    recommendation = recommend_base(bases_data)
    return {
        "recommendation": recommendation,
        "all_bases_summary": [
            {
                "name": b["base_name"],
                "load_rate": b["load_rate"],
                "pending_orders": b["pending_orders"],
                "daily_capacity": b["daily_capacity"],
            }
            for b in bases_data
        ],
    }


async def estimate_delivery_tool(
    base_name: str, order_quantity: int = 1
) -> dict[str, Any]:
    """Estimate delivery time for a new order at a specific base."""
    config = next((c for c in BASE_CONFIGS if c["name"] == base_name), None)
    if not config:
        return {"error": f"未找到基地: {base_name}"}
    
    adapter = get_adapter()
    pending = await adapter.get_pending_orders_by_base(base_name)
    
    result = estimate_delivery(
        base_name=base_name,
        machine_count=config["machine_count"],
        per_machine_daily_output=config["per_machine_daily_output"],
        pending_orders=pending,
        order_quantity=order_quantity,
    )
    return result


def register_capacity_tools():
    """Register all capacity analysis tools."""
    
    register_tool(
        name="analyze_capacity",
        description="分析中试基地的产能负荷情况，包括负荷率、超负荷倍数、完工天数等。可以查询单个基地或全部基地",
        parameters={
            "type": "object",
            "properties": {
                "base_name": {
                    "type": "string",
                    "description": "基地名称（可选），如不传则返回所有基地的负荷分析。例如：广州基地、上海基地",
                },
            },
        },
        func=analyze_capacity,
    )
    
    register_tool(
        name="recommend_base",
        description="根据各基地当前产能负荷，智能推荐最适合下单的中试基地",
        parameters={
            "type": "object",
            "properties": {},
        },
        func=recommend_base_tool,
    )
    
    register_tool(
        name="estimate_delivery",
        description="估算在指定基地下新订单的交期天数",
        parameters={
            "type": "object",
            "properties": {
                "base_name": {
                    "type": "string",
                    "description": "基地名称，例如：广州基地",
                },
                "order_quantity": {
                    "type": "integer",
                    "description": "订单数量（默认为1）",
                },
            },
            "required": ["base_name"],
        },
        func=estimate_delivery_tool,
    )
