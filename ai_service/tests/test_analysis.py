"""Tests for capacity analysis service."""

from app.services.analysis_service import (
    calculate_daily_capacity,
    calculate_load_metrics,
    analyze_base_capacity,
    recommend_base,
    estimate_delivery,
)


class TestCalculateDailyCapacity:
    def test_normal(self):
        assert calculate_daily_capacity(10, 8) == 80

    def test_zero_machines(self):
        assert calculate_daily_capacity(0, 8) == 0

    def test_zero_output(self):
        assert calculate_daily_capacity(10, 0) == 0

    def test_large_values(self):
        assert calculate_daily_capacity(100, 50) == 5000


class TestCalculateLoadMetrics:
    def test_normal_load(self):
        metrics = calculate_load_metrics(40, 80)
        assert metrics["load_rate"] == 50.0
        assert metrics["overload_multiplier"] == 0.5
        assert metrics["days_to_complete"] == 0.5

    def test_overload(self):
        metrics = calculate_load_metrics(160, 80)
        assert metrics["load_rate"] == 200.0
        assert metrics["overload_multiplier"] == 2.0
        assert metrics["days_to_complete"] == 2.0

    def test_zero_capacity(self):
        metrics = calculate_load_metrics(10, 0)
        assert metrics["load_rate"] == 0.0


class TestAnalyzeBaseCapacity:
    def test_full_analysis(self):
        result = analyze_base_capacity(
            base_name="广州基地",
            location="广东广州",
            machine_count=12,
            per_machine_daily_output=8,
            pending_orders=48,
        )
        assert result["daily_capacity"] == 96
        assert result["load_rate"] == 50.0
        assert result["overload_multiplier"] == 0.5
        assert result["days_to_complete"] == 0.5


class TestRecommendBase:
    def test_recommend_lowest_load(self):
        bases = [
            {"base_name": "A", "daily_capacity": 100, "pending_orders": 80,
             "load_rate": 80.0, "days_to_complete": 0.8},
            {"base_name": "B", "daily_capacity": 100, "pending_orders": 30,
             "load_rate": 30.0, "days_to_complete": 0.3},
            {"base_name": "C", "daily_capacity": 100, "pending_orders": 50,
             "load_rate": 50.0, "days_to_complete": 0.5},
        ]
        result = recommend_base(bases)
        assert result["recommended_base"] == "B"
        assert result["load_rate"] == 30.0

    def test_empty_bases(self):
        result = recommend_base([])
        assert result["recommended_base"] is None


class TestEstimateDelivery:
    def test_estimate(self):
        result = estimate_delivery(
            base_name="广州基地",
            machine_count=10,
            per_machine_daily_output=8,
            pending_orders=40,
            order_quantity=5,
        )
        assert result["daily_capacity"] == 80
        assert result["estimated_days"] == 0.6
        assert result["load_rate"] == 50.0

    def test_zero_capacity(self):
        result = estimate_delivery("X基地", 0, 0, 10)
        assert result["estimated_days"] == -1
