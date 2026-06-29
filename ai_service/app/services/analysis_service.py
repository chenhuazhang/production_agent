"""Capacity analysis service with load calculation formulas."""

from typing import Any


def calculate_daily_capacity(machine_count: int, per_machine_output: int) -> int:
    """Calculate daily capacity quota.
    
    Formula: daily_capacity = machine_count * per_machine_daily_output
    """
    if machine_count <= 0 or per_machine_output <= 0:
        return 0
    return machine_count * per_machine_output


def calculate_load_metrics(pending_orders: int, daily_capacity: int) -> dict[str, float]:
    """Calculate all load metrics for a base.
    
    Formulas:
    - load_rate = pending_orders / daily_capacity * 100 (%)
    - overload_multiplier = pending_orders / daily_capacity
    - days_to_complete = pending_orders / daily_capacity
    """
    if daily_capacity <= 0:
        return {
            "load_rate": 0.0,
            "overload_multiplier": 0.0,
            "days_to_complete": 0.0,
        }
    
    load_rate = round(pending_orders / daily_capacity * 100, 1)
    overload_multiplier = round(pending_orders / daily_capacity, 1)
    days_to_complete = round(pending_orders / daily_capacity, 1)
    
    return {
        "load_rate": load_rate,
        "overload_multiplier": overload_multiplier,
        "days_to_complete": days_to_complete,
    }


def analyze_base_capacity(
    base_name: str,
    location: str,
    machine_count: int,
    per_machine_daily_output: int,
    pending_orders: int,
) -> dict[str, Any]:
    """Full capacity analysis for a single base."""
    daily_capacity = calculate_daily_capacity(machine_count, per_machine_daily_output)
    metrics = calculate_load_metrics(pending_orders, daily_capacity)
    
    return {
        "base_name": base_name,
        "location": location,
        "machine_count": machine_count,
        "per_machine_daily_output": per_machine_daily_output,
        "daily_capacity": daily_capacity,
        "pending_orders": pending_orders,
        **metrics,
    }


def recommend_base(bases_data: list[dict[str, Any]]) -> dict[str, Any]:
    """Recommend the base with the lowest load rate for new orders.
    
    Returns the recommended base with reason.
    """
    if not bases_data:
        return {"recommended_base": None, "reason": "没有可用基地数据"}
    
    # Filter out bases with 0 capacity
    valid_bases = [b for b in bases_data if b.get("daily_capacity", 0) > 0]
    if not valid_bases:
        return {"recommended_base": None, "reason": "没有有效产能的基地"}
    
    best = min(valid_bases, key=lambda b: b.get("load_rate", float("inf")))
    
    return {
        "recommended_base": best["base_name"],
        "reason": f"{best['base_name']}当前负荷率最低（{best['load_rate']}%），"
                  f"日产能{best['daily_capacity']}单，待处理{best['pending_orders']}单，"
                  f"预计{best['days_to_complete']}天可完成",
        "load_rate": best["load_rate"],
        "estimated_days": best["days_to_complete"],
    }


def estimate_delivery(
    base_name: str,
    machine_count: int,
    per_machine_daily_output: int,
    pending_orders: int,
    order_quantity: int = 1,
) -> dict[str, Any]:
    """Estimate delivery time for a new order at a specific base."""
    daily_capacity = calculate_daily_capacity(machine_count, per_machine_daily_output)
    if daily_capacity <= 0:
        return {
            "base_name": base_name,
            "estimated_days": -1,
            "message": "该基地无有效产能",
        }
    
    total_pending = pending_orders + order_quantity
    estimated_days = round(total_pending / daily_capacity, 1)
    load_rate = round(pending_orders / daily_capacity * 100, 1)
    
    return {
        "base_name": base_name,
        "estimated_days": estimated_days,
        "daily_capacity": daily_capacity,
        "pending_orders": pending_orders,
        "new_order_quantity": order_quantity,
        "load_rate": load_rate,
        "message": f"预计在{base_name}需要{estimated_days}天完成",
    }
