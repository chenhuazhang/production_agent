from pydantic import BaseModel, Field
from typing import Any
from datetime import datetime


# === Chat Models ===

class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str
    user_id: str = "default"


class ToolCallInfo(BaseModel):
    id: str
    name: str
    arguments: str


class ToolResult(BaseModel):
    tool_call_id: str
    name: str
    result: Any


class ChatResponse(BaseModel):
    conversation_id: str
    content: str
    tool_calls: list[ToolCallInfo] | None = None
    tool_results: list[ToolResult] | None = None


# === Order Models ===

class OrderInfo(BaseModel):
    order_no: str
    product_name: str
    customer: str
    current_stage: str
    stage_status: str
    planned_date: str | None = None
    assignee: str | None = None
    base_name: str | None = None
    notes: str | None = None


class OrderProgressResponse(BaseModel):
    order_no: str
    stages: list[dict[str, Any]]
    current_stage: str
    estimated_completion: str | None = None


# === Capacity Models ===

class BaseCapacity(BaseModel):
    base_name: str
    location: str
    machine_count: int
    per_machine_daily_output: int
    daily_capacity: int = Field(description="machine_count * per_machine_daily_output")
    pending_orders: int
    load_rate: float = Field(description="pending_orders / daily_capacity * 100")
    overload_multiplier: float = Field(description="pending_orders / daily_capacity")
    days_to_complete: float = Field(description="pending_orders / daily_capacity")


class RecommendationResult(BaseModel):
    recommended_base: str
    reason: str
    load_rate: float
    estimated_days: float


class CapacityAnalysisResponse(BaseModel):
    bases: list[BaseCapacity]
    recommendation: RecommendationResult | None = None


class DeliveryEstimate(BaseModel):
    base_name: str
    estimated_days: float
    daily_capacity: int
    pending_orders: int
    load_rate: float


# === Tool Execution ===

class ToolExecutionRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any]


class ToolExecutionResponse(BaseModel):
    result: Any
    success: bool = True
    error: str | None = None
