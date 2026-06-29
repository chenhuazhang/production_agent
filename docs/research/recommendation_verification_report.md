# 中试 AI Agent 项目深度调研报告：下单推荐准确性验证方案

## Executive Summary

本报告对中试 AI Agent 项目（production_agent）进行了全面的代码审查和架构分析，聚焦于核心功能"基地订单负荷分析及下单推荐"的准确性保障问题。

**关键发现：**

1. **推荐算法过于简化**：当前实现仅基于"最低负荷率"单一维度推荐，缺少产品类型匹配、地理位置、订单紧急程度、换色工时等关键决策因子
2. **数据源不一致**：基地产能配置在 Python AI 服务中硬编码，与 Web 层数据库中的数据可能存在偏差
3. **待处理订单数来自 Mock 数据**：生产环境如何获取实时准确的待处理订单数尚未解决
4. **LLM 工具调用缺乏验证机制**：无法保证 LLM 在正确场景调用正确工具，也无法验证工具返回结果被正确解读
5. **缺乏端到端验证框架**：现有测试仅覆盖计算逻辑的 happy path，无系统性准确性验证方案

**核心建议：** 建立三层验证体系（数据层 → 算法层 → 交互层），在上线前完成至少 50 组历史数据回归测试，并在初期采用"AI 推荐 + 人工确认"的半自动模式。

---

## 目录

1. [项目现状分析](#1-项目现状分析)
2. [关键风险识别](#2-关键风险识别)
3. [需重点调研确认的问题](#3-需重点调研确认的问题)
4. [下单推荐准确性验证方案](#4-下单推荐准确性验证方案)
5. [验证测试用例设计](#5-验证测试用例设计)
6. [实施建议](#6-实施建议)

---

## 1. 项目现状分析

### 1.1 系统架构概览

项目采用 Next.js + Python FastAPI 双服务架构：

```
Web 层 (Next.js:3000)  →  AI 服务 (FastAPI:8000)  →  Mock 数据适配器
      ↓                                                    ↑
  SQLite (应用DB)                                    待对接真实业务DB
```

**核心文件分布：**

| 功能模块 | 文件 | 职责 |
|---------|------|------|
| 负荷计算 | `ai_service/app/services/analysis_service.py` | 日产能、负荷率、推荐算法 |
| 负荷工具 | `ai_service/app/tools/capacity_tools.py` | AI Function Calling 工具封装 |
| 数据适配 | `ai_service/app/adapters/mock_adapter.py` | 模拟业务数据库 |
| 对话编排 | `ai_service/app/services/chat_service.py` | LLM 调用 + 工具执行 |
| 数据库 | `web/prisma/schema.prisma` | Base、CapacitySnapshot 模型 |
| 种子数据 | `web/scripts/seed.ts` | 五大基地初始化 |

### 1.2 当前推荐算法逻辑

```python
# analysis_service.py: recommend_base()
best = min(valid_bases, key=lambda b: b.get("load_rate", float("inf")))
```

**当前逻辑：选择负荷率最低的基地。**

**计算公式：**
- 日产能定额 = 设备台数 × 单台日标准产量
- 负荷率 = 待处理订单量 ÷ 日产能定额 × 100%
- 完工天数 = 待单量 ÷ 日产能定额

### 1.3 当前测试覆盖情况

| 测试文件 | 覆盖范围 | 测试数量 |
|---------|---------|---------|
| `tests/test_analysis.py` | `analysis_service.py` 纯函数 | 8个用例 |
| 无 | LLM 工具调用准确性 | 0 |
| 无 | 端到端推荐准确性 | 0 |
| 无 | 数据一致性验证 | 0 |

---

## 2. 关键风险识别

### 风险等级定义

| 等级 | 含义 | 影响 |
|------|------|------|
| 🔴 高 | 可能导致推荐结果完全错误 | 业务损失 |
| 🟡 中 | 可能降低推荐质量 | 用户体验差 |
| 🟢 低 | 边缘情况 | 可接受 |

### 风险清单

#### 🔴 风险 1：推荐算法维度单一（高风险）

**问题：** 当前仅按"负荷率最低"推荐，忽略了多个业务关键因子：

```python
# 当前算法 - 只看 load_rate
best = min(valid_bases, key=lambda b: b.get("load_rate", float("inf")))
```

**缺失的决策维度：**

| 缺失维度 | 业务影响 | 示例 |
|---------|---------|------|
| 产品类型匹配 | 某些基地不具备特定产品的生产能力 | PC材料只能在东莞、苏州生产 |
| 地理距离/物流 | 客户就近基地可节省物流成本和时间 | 华东客户应优先苏州基地 |
| 订单紧急程度 | 急单应推荐交期最短而非仅负荷最低 | 加急订单需要最快完工 |
| 换色工时 | 频繁换色会降低实际产能 | 深色→浅色换色需清洗8小时 |
| 历史质量表现 | 某些基地对特定产品良率更高 | 东莞基地 PC 良率98%，天津85% |
| 设备维护计划 | 即将停机的基地实际可用产能更低 | 成都基地下周计划检修2台设备 |

#### 🔴 风险 2：待处理订单数准确性（高风险）

**问题：** 待处理订单数是推荐的核心输入，但当前来源不可靠：

```python
# mock_adapter.py - 硬编码的静态数据
MOCK_BASE_PENDING: dict[str, int] = {
    "东莞基地": 35,  # 这个值在运行时是固定的
    "苏州基地": 22,
    ...
}
```

**实际生产环境中，待处理订单数应该：**
- 实时从业务系统（ERP/MES）拉取
- 区分"已排产待生产"和"未排产"两种状态
- 考虑当日新增和完成订单的动态变化
- 排除已完成、已取消的订单

#### 🔴 风险 3：数据源不一致（高风险）

**问题：** 基地配置数据存在多处，且可能不同步：

| 数据来源 | 位置 | 当前数据 |
|---------|------|---------|
| Python AI 服务 | `capacity_tools.py` 硬编码 | 东莞:12台×8单, 苏州:10台×10单... |
| Web 种子数据 | `seed.ts` | 东莞:12台×8单, 苏州:10台×10单... |
| 设计文档 | `spec.md` | 基地A-E: 5/8/6/4/7台, 均20单/台 |

**注意：** 设计文档与实际代码的基地命名和参数完全不匹配！文档用的是"基地A-E"，代码用的是"东莞/苏州/天津/成都/武汉"。

#### 🟡 风险 4：LLM 工具调用不可控（中风险）

**问题：** LLM 对工具的选择和参数解析存在不确定性：

1. **意图误判**：用户说"哪个基地好"，LLM 可能调用 `analyze_capacity` 而非 `recommend_base`
2. **参数幻觉**：用户说"帮我推荐基地"，LLM 可能虚构一个不存在的基地名传给工具
3. **结果误读**：工具返回 JSON，LLM 可能错误解读数据并给出不准确建议

#### 🟡 风险 5：计算公式的业务合理性未确认（中风险）

**问题：** 当前公式将所有订单视为等权重，但实际上：

```python
# 所有订单同等对待，但实际差异很大
load_rate = pending_orders / daily_capacity * 100
```

- 大批量订单（50吨）和小样单（50kg）对产能占用差异巨大
- 不同产品的生产速度差异（简单混合 vs 复杂配方）
- 换色、换料时间未计入实际可用产能

#### 🟡 风险 6：Capacity Snapshot 机制不完整（中风险）

**问题：** `CapacitySnapshot` 模型存在但：
- 没有定时任务生成快照
- 快照数据如何更新未知
- Python AI 服务未使用数据库，用的是硬编码配置

---

## 3. 需重点调研确认的问题

### 3.1 业务规则确认（必须与业务方确认）

| 序号 | 待确认问题 | 影响 |
|------|----------|------|
| 1 | 推荐下单基地时，是否仅考虑负荷率？还是有其他优先级规则？ | 决定算法复杂度 |
| 2 | 不同产品是否只能  在特定基地生产？（产品-基地约束矩阵） | 影响推荐可行性 |
| 3 | "待处理订单"的准确定义是什么？（包含哪些状态的订单） | 影响数据准确性 |
| 4 | 订单对产能的占用是否有差异？（大单 vs 小单） | 影响计算精度 |
| 5 | 单台日标准产量是否因产品类型不同而变化？ | 影响产能计算 |
| 6 | 是否有设备维护/停机计划需要纳入考虑？ | 影响可用产能 |
| 7 | 历史推荐准确率是否有基准数据？ | 设定验证目标 |
| 8 | 推荐的容错率是多少？（允许推荐次优基地的容忍度） | 决定验收标准 |

### 3.2 技术实现确认

| 序号 | 待确认问题 | 当前状态 |
|------|----------|---------|
| 1 | 业务数据库对接方案（SQL Server/Oracle 直连还是 API） | 未开始 |
| 2 | 实时数据刷新频率（多久更新一次待处理订单数） | 未确定 |
| 3 | 是否需要负荷快照历史（用于趋势分析和预测） | Schema 存在但未使用 |
| 4 | LLM 模型选择（GPT-4o vs 其他，影响 function calling 准确性） | 配置 GPT-4o |
| 5 | 并发处理能力（多用户同时请求推荐是否会冲突） | 未考虑 |

---

## 4. 下单推荐准确性验证方案

### 4.1 验证体系总览

```
三层验证体系
├── 第一层：数据层验证（输入数据的准确性）
├── 第二层：算法层验证（计算和推荐逻辑的正确性）
└── 第三层：交互层验证（LLM 工具调用和结果呈现的正确性）
```

### 4.2 第一层：数据层验证

#### 4.2.1 基地配置数据验证

**目标：** 确保系统中的基地产能参数与真实情况一致

**验证方法：**

| 验证项 | 方法 | 通过标准 |
|--------|------|---------|
| 基地数量正确性 | 对比业务台账 | 五大基地全部存在 |
| 设备台数准确性 | 对比设备管理系统 | 误差 ≤ 0台 |
| 单台日标准产量 | 对比历史产线数据 | 误差 ≤ 10% |
| 日产能定额计算 | 手工计算核对 | 100% 正确 |
| 基地名称与业务一致 | 业务方确认 | 完全匹配 |

**测试实现：**

```python
# tests/test_data_accuracy.py

def test_base_config_matches_reality():
    """基地配置必须与业务台账一致"""
    from app.tools.capacity_tools import BASE_CONFIGS
    
    # 从业务方获取的真实数据（示例）
    expected = {
        "东莞基地": {"machine_count": 12, "per_machine_daily_output": 8},
        "苏州基地": {"machine_count": 10, "per_machine_daily_output": 10},
        "天津基地": {"machine_count": 8, "per_machine_daily_output": 6},
        "成都基地": {"machine_count": 15, "per_machine_daily_output": 7},
        "武汉基地": {"machine_count": 9, "per_machine_daily_output": 9},
    }
    
    for config in BASE_CONFIGS:
        name = config["name"]
        assert name in expected, f"未知基地: {name}"
        assert config["machine_count"] == expected[name]["machine_count"]
        assert config["per_machine_daily_output"] == expected[name]["per_machine_daily_output"]

def test_daily_capacity_calculation():
    """日产能计算必须正确"""
    from app.services.analysis_service import calculate_daily_capacity
    
    test_cases = [
        (12, 8, 96),   # 东莞: 12台 × 8单/台 = 96单/天
        (10, 10, 100), # 苏州: 10台 × 10单/台 = 100单/天
        (8, 6, 48),    # 天津: 8台 × 6单/台 = 48单/天
        (15, 7, 105),  # 成都: 15台 × 7单/台 = 105单/天
        (9, 9, 81),    # 武汉: 9台 × 9单/台 = 81单/天
    ]
    
    for machines, output, expected in test_cases:
        assert calculate_daily_capacity(machines, output) == expected
```

#### 4.2.2 待处理订单数验证

**目标：** 确保系统获取的待处理订单数与业务系统一致

**验证方法：**

```python
# tests/test_pending_orders_accuracy.py

import pytest
from app.adapters.mock_adapter import get_adapter

EXPECTED_PENDING = {
    "东莞基地": 35,
    "苏州基地": 22,
    "天津基地": 48,
    "成都基地": 15,
    "武汉基地": 28,
}

@pytest.mark.asyncio
async def test_pending_orders_match_business_system():
    """待处理订单数必须与业务系统一致（上线前必须替换为真实数据源验证）"""
    adapter = get_adapter()
    
    for base_name, expected_count in EXPECTED_PENDING.items():
        actual = await adapter.get_pending_orders_by_base(base_name)
        # 允许 5% 误差（因为订单状态实时变化）
        tolerance = max(1, int(expected_count * 0.05))
        assert abs(actual - expected_count) <= tolerance, \
            f"{base_name}: 期望 {expected_count}±{tolerance}, 实际 {actual}"
```

### 4.3 第二层：算法层验证

#### 4.3.1 基础计算正确性验证

```python
# tests/test_formula_validation.py

from app.services.analysis_service import calculate_load_metrics

class TestFormulaValidation:
    """验证所有计算公式的正确性"""
    
    def test_load_rate_formula(self):
        """负荷率 = 待处理订单量 ÷ 日产能定额 × 100%"""
        # 设计文档示例: 500 ÷ 100 × 100% = 500%
        result = calculate_load_metrics(500, 100)
        assert result["load_rate"] == 500.0
    
    def test_overload_multiplier_formula(self):
        """超负荷倍数 = 待处理订单量 ÷ 日产能定额"""
        # 设计文档示例: 500 ÷ 100 = 5.0 倍
        result = calculate_load_metrics(500, 100)
        assert result["overload_multiplier"] == 5.0
    
    def test_days_to_complete_formula(self):
        """完工天数 = 待处理订单量 ÷ 日产能定额"""
        # 设计文档示例: 500 ÷ 100 = 5 天
        result = calculate_load_metrics(500, 100)
        assert result["days_to_complete"] == 5.0
    
    def test_boundary_zero_pending(self):
        """边界：零待处理订单"""
        result = calculate_load_metrics(0, 100)
        assert result["load_rate"] == 0.0
        assert result["overload_multiplier"] == 0.0
    
    def test_boundary_zero_capacity(self):
        """边界：零产能（设备全部停机）"""
        result = calculate_load_metrics(10, 0)
        assert result["load_rate"] == 0.0  # 应返回安全值
    
    def test_precision(self):
        """精度：保留一位小数"""
        result = calculate_load_metrics(33, 96)
        assert result["load_rate"] == 34.4  # 33/96*100 = 34.375 → 34.4
```

#### 4.3.2 推荐逻辑正确性验证

```python
# tests/test_recommendation_logic.py

from app.services.analysis_service import recommend_base

class TestRecommendationLogic:
    """验证推荐算法在各种场景下的正确性"""
    
    def test_basic_recommendation(self):
        """基础场景：推荐负荷最低的基地"""
        bases = [
            {"base_name": "东莞基地", "load_rate": 36.5, "daily_capacity": 96, 
             "pending_orders": 35, "days_to_complete": 0.4},
            {"base_name": "苏州基地", "load_rate": 22.0, "daily_capacity": 100,
             "pending_orders": 22, "days_to_complete": 0.2},
            {"base_name": "天津基地", "load_rate": 100.0, "daily_capacity": 48,
             "pending_orders": 48, "days_to_complete": 1.0},
            {"base_name": "成都基地", "load_rate": 14.3, "daily_capacity": 105,
             "pending_orders": 15, "days_to_complete": 0.1},
            {"base_name": "武汉基地", "load_rate": 34.6, "daily_capacity": 81,
             "pending_orders": 28, "days_to_complete": 0.3},
        ]
        result = recommend_base(bases)
        assert result["recommended_base"] == "成都基地"  # 负荷率最低 14.3%
    
    def test_all_bases_overloaded(self):
        """所有基地都超负荷时仍应返回推荐"""
        bases = [
            {"base_name": "A", "load_rate": 150.0, "daily_capacity": 100, 
             "pending_orders": 150, "days_to_complete": 1.5},
            {"base_name": "B", "load_rate": 200.0, "daily_capacity": 100,
             "pending_orders": 200, "days_to_complete": 2.0},
        ]
        result = recommend_base(bases)
        assert result["recommended_base"] == "A"  # 相对较低的负荷
    
    def test_same_load_rate(self):
        """负荷率相同时的处理（需确认是否有次级排序条件）"""
        bases = [
            {"base_name": "A", "load_rate": 50.0, "daily_capacity": 100,
             "pending_orders": 50, "days_to_complete": 0.5},
            {"base_name": "B", "load_rate": 50.0, "daily_capacity": 200,
             "pending_orders": 100, "days_to_complete": 0.5},
        ]
        result = recommend_base(bases)
        # 当前实现：相同负荷率时，取先出现的那个
        # 业务上可能需要：选产能更大的（有更多余量）
        assert result["recommended_base"] in ["A", "B"]
    
    def test_single_base_available(self):
        """只有一个基地可用"""
        bases = [
            {"base_name": "A", "load_rate": 80.0, "daily_capacity": 100,
             "pending_orders": 80, "days_to_complete": 0.8},
        ]
        result = recommend_base(bases)
        assert result["recommended_base"] == "A"
    
    def test_no_valid_capacity(self):
        """所有基地产能为0"""
        bases = [
            {"base_name": "A", "load_rate": 0, "daily_capacity": 0,
             "pending_orders": 10, "days_to_complete": 0},
        ]
        result = recommend_base(bases)
        assert result["recommended_base"] is None
```

#### 4.3.3 历史数据回归测试

**目标：** 使用历史真实数据验证推荐结果与实际最优选择是否一致

```python
# tests/test_historical_regression.py

import pytest
from app.services.analysis_service import recommend_base, analyze_base_capacity

# 历史数据样本（需从业务系统获取至少 50 组）
HISTORICAL_CASES = [
    {
        "date": "2026-05-15",
        "bases_snapshot": [
            {"base_name": "东莞基地", "pending_orders": 40, "machine_count": 12, "per_machine_daily_output": 8},
            {"base_name": "苏州基地", "pending_orders": 25, "machine_count": 10, "per_machine_daily_output": 10},
            {"base_name": "天津基地", "pending_orders": 50, "machine_count": 8, "per_machine_daily_output": 6},
            {"base_name": "成都基地", "pending_orders": 10, "machine_count": 15, "per_machine_daily_output": 7},
            {"base_name": "武汉基地", "pending_orders": 30, "machine_count": 9, "per_machine_daily_output": 9},
        ],
        "actual_best_choice": "成都基地",  # 业务方确认的历史最优选择
        "actual_outcome": "成都基地 0.1天完成",  # 实际结果
    },
    # ... 更多历史案例
]

class TestHistoricalRegression:
    @pytest.mark.parametrize("case", HISTORICAL_CASES)
    def test_recommendation_matches_historical_best(self, case):
        """推荐结果应与历史最优选择一致"""
        bases_data = []
        for b in case["bases_snapshot"]:
            result = analyze_base_capacity(
                base_name=b["base_name"],
                location="",
                machine_count=b["machine_count"],
                per_machine_daily_output=b["per_machine_daily_output"],
                pending_orders=b["pending_orders"],
            )
            bases_data.append(result)
        
        recommendation = recommend_base(bases_data)
        
        # 至少 80% 的历史案例应与业务方确认的最优选择一致
        # （允许 20% 因为业务方可能考虑了额外因素）
        assert recommendation["recommended_base"] == case["actual_best_choice"], \
            f"日期 {case['date']}: 系统推荐 {recommendation['recommended_base']}, " \
            f"实际最优 {case['actual_best_choice']}"
```

### 4.4 第三层：交互层验证

#### 4.4.1 LLM 工具调用准确性验证

**目标：** 验证 LLM 在正确场景调用正确工具

```python
# tests/test_llm_tool_selection.py

import pytest
from app.services.chat_service import chat_service

class TestLLMToolSelection:
    """验证 LLM 的工具选择准确性"""
    
    TOOL_SELECTION_CASES = [
        {
            "user_message": "五大基地现在哪个负荷最低？",
            "expected_tool": "analyze_capacity",
        },
        {
            "user_message": "新订单下到哪个基地最合适？",
            "expected_tool": "recommend_base",
        },
        {
            "user_message": "在东莞基地下 5 单要多久？",
            "expected_tool": "estimate_delivery",
        },
        {
            "user_message": "订单 ZS-2026-001 现在到哪步了？",
            "expected_tool": "query_order_progress",
        },
        {
            "user_message": "搜一下比亚迪的订单",
            "expected_tool": "search_orders",
        },
    ]
    
    @pytest.mark.asyncio
    @pytest.mark.parametrize("case", TOOL_SELECTION_CASES)
    async def test_tool_selection(self, case):
        """LLM 应根据用户意图选择正确的工具"""
        # 重置对话
        result = await chat_service.chat(message=case["user_message"])
        
        # 检查是否调用了预期工具
        if result.get("tool_results"):
            tool_names = [tr["name"] for tr in result["tool_results"]]
            assert case["expected_tool"] in tool_names, \
                f"消息: '{case['user_message']}' 期望调用 {case['expected_tool']}, " \
                f"实际调用: {tool_names}"
        else:
            pytest.fail(f"消息: '{case['user_message']}' 未调用任何工具")
```

#### 4.4.2 推荐结果呈现验证

```python
# tests/test_recommendation_presentation.py

import pytest
from app.services.chat_service import chat_service

class TestRecommendationPresentation:
    """验证 LLM 对推荐结果的解读是否准确"""
    
    @pytest.mark.asyncio
    async def test_recommendation_includes_reason(self):
        """推荐结果必须包含推荐理由"""
        result = await chat_service.chat(
            message="新订单下到哪个基地最好？"
        )
        content = result["content"]
        
        # 回复中应包含基地名称
        base_names = ["东莞基地", "苏州基地", "天津基地", "成都基地", "武汉基地"]
        has_base_name = any(name in content for name in base_names)
        assert has_base_name, f"回复中未包含任何基地名称: {content}"
        
        # 回复中应包含负荷率或相关指标
        has_metric = any(kw in content for kw in ["负荷", "产能", "天", "订单"])
        assert has_metric, f"回复中未包含任何量化指标: {content}"
    
    @pytest.mark.asyncio
    async def test_recommendation_no_hallucination(self):
        """推荐结果不应包含虚构的基地"""
        result = await chat_service.chat(
            message="推荐一个基地下单"
        )
        content = result["content"]
        
        valid_bases = ["东莞基地", "苏州基地", "天津基地", "成都基地", "武汉基地"]
        # 检查是否提到了不存在的基地
        import re
        mentioned_bases = re.findall(r'[\u4e00-\u9fa5]+基地', content)
        for base in mentioned_bases:
            assert base in valid_bases or "中试基地" in base, \
                f"回复中出现了未知基地: {base}"
```

### 4.5 端到端验收测试

```python
# tests/test_e2e_recommendation.py

import pytest
import httpx

class TestE2ERecommendation:
    """端到端推荐流程验收测试"""
    
    BASE_URL = "http://localhost:8000"
    
    @pytest.mark.asyncio
    async def test_full_recommendation_flow(self):
        """完整的推荐对话流程"""
        async with httpx.AsyncClient() as client:
            # Step 1: 用户问推荐
            response = await client.post(f"{self.BASE_URL}/api/chat", json={
                "message": "我要下一个新订单，推荐我到哪个基地？",
                "conversation_id": None,
            })
            
            assert response.status_code == 200
            data = response.json()
            
            # 验证响应结构
            assert "content" in data
            assert "conversation_id" in data
            assert data["content"] is not None
            
            # 验证推荐内容合理
            content = data["content"]
            assert len(content) > 20, "回复过短，可能缺少推荐理由"
            
            # 验证有工具调用记录
            assert data.get("tool_results") is not None or \
                   data.get("tool_calls") is not None, \
                   "推荐流程未触发工具调用"
    
    @pytest.mark.asyncio
    async def test_capacity_analysis_then_recommend(self):
        """先分析负荷，再推荐的连贯对话"""
        async with httpx.AsyncClient() as client:
            # Step 1: 分析负荷
            response1 = await client.post(f"{self.BASE_URL}/api/chat", json={
                "message": "分析一下五大基地的负荷情况",
            })
            conv_id = response1.json()["conversation_id"]
            
            # Step 2: 在同一对话中请求推荐
            response2 = await client.post(f"{self.BASE_URL}/api/chat", json={
                "message": "那我应该下到哪个基地？",
                "conversation_id": conv_id,
            })
            
            content = response2.json()["content"]
            # 推荐应基于前面的分析结果
            assert any(base in content for base in ["东莞", "苏州", "天津", "成都", "武汉"])
```

---

## 5. 验证测试用例设计

### 5.1 测试用例矩阵

| 测试类型 | 测试项 | 数量 | 优先级 |
|---------|--------|------|--------|
| 数据准确性 | 基地配置与业务台账一致 | 5 | P0 |
| 数据准确性 | 日产能计算正确 | 5 | P0 |
| 数据准确性 | 待处理订单数与业务系统一致 | 5 | P0 |
| 公式正确性 | 负荷率公式正确 | 3 | P0 |
| 公式正确性 | 超负荷倍数公式正确 | 3 | P0 |
| 公式正确性 | 完工天数公式正确 | 3 | P0 |
| 边界条件 | 零待处理订单 | 2 | P1 |
| 边界条件 | 零产能（设备停机） | 2 | P1 |
| 边界条件 | 所有基地超负荷 | 2 | P1 |
| 边界条件 | 负荷率相同 | 2 | P2 |
| 推荐逻辑 | 推荐负荷最低基地 | 5 | P0 |
| 推荐逻辑 | 推荐理由包含关键指标 | 5 | P0 |
| LLM 工具选择 | 正确工具被调用 | 10 | P0 |
| LLM 工具选择 | 参数正确传递 | 10 | P1 |
| LLM 结果解读 | 无幻觉（无虚构基地） | 5 | P0 |
| 端到端 | 完整对话流程 | 5 | P0 |
| 历史回归 | 与历史最优选择一致 | 50 | P1 |

**总计：约 122 个测试用例**

### 5.2 验收标准

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 公式计算准确率 | 100% | 单元测试 |
| 推荐结果合理性 | ≥ 90% | 历史数据回归 + 专家评审 |
| LLM 工具选择准确率 | ≥ 95% | 意图测试集 |
| LLM 结果无幻觉率 | 100% | 幻觉检测测试 |
| 端到端流程通过率 | ≥ 95% | E2E 测试 |

---

## 6. 实施建议

### 6.1 分阶段验证计划

**阶段一：基础验证（1-2周）**

- [ ] 完成公式计算单元测试（已有，补充边界用例）
- [ ] 验证基地配置数据与业务台账一致
- [ ] 确认待处理订单的业务定义
- [ ] 补充推荐逻辑的边界测试

**阶段二：集成验证（2-3周）**

- [ ] 实现 LLM 工具选择测试框架
- [ ] 完成 20+ 组历史数据回归测试
- [ ] 实现端到端对话流程测试
- [ ] 验证流式输出模式下推荐结果正确性

**阶段三：生产验证（持续）**

- [ ] 建立推荐结果人工复核机制（初期 100% 复核）
- [ ] 收集用户反馈，建立"推荐满意度"指标
- [ ] 每周分析推荐偏差，优化算法
- [ ] 逐步降低人工复核比例（100% → 50% → 20%）

### 6.2 算法优化建议（优先级排序）

| 优先级 | 优化项 | 预期效果 | 复杂度 |
|--------|--------|---------|--------|
| P0 | 将基地配置从硬编码迁移到数据库 | 消除数据不一致 | 低 |
| P0 | 实现业务数据库适配器（替换 Mock） | 输入数据准确 | 中 |
| P1 | 推荐算法增加产品类型匹配维度 | 推荐更合理 | 中 |
| P1 | 建立推荐结果评估反馈机制 | 持续改进 | 低 |
| P2 | 增加地理距离/物流成本维度 | 降低物流成本 | 中 |
| P2 | 增加订单紧急程度维度 | 急单快速处理 | 中 |
| P3 | 引入历史质量数据 | 提升良率 | 高 |

### 6.3 上线前检查清单

- [ ] 所有 P0 测试用例 100% 通过
- [ ] 历史数据回归测试 ≥ 50 组，准确率 ≥ 80%
- [ ] LLM 工具选择测试 ≥ 10 组，准确率 ≥ 95%
- [ ] 业务方确认推荐算法逻辑（签字确认）
- [ ] 基地配置数据与业务台账核对一致
- [ ] 待处理订单数与业务系统数据核对一致
- [ ] 边界情况处理逻辑确认（全超负荷、零产能等）
- [ ] 性能测试：推荐接口响应时间 < 5 秒
- [ ] 建立推荐结果人工复核 SOP
- [ ] 灰度发布计划（先内部测试用户 → 再全量）

---

## 方法论说明

本报告基于以下方法生成：

1. **代码审查**：对 production_agent 项目全部源码进行逐文件审查
2. **架构分析**：分析系统各层的数据流和依赖关系
3. **交叉验证**：对比设计文档、计划文档与实际代码实现的一致性
4. **风险识别**：基于行业最佳实践识别推荐系统的典型风险点
5. **测试设计**：基于等价类划分和边界值分析设计测试用例

---

*报告生成日期：2026年6月2日*
*分析方法：Deep Research (8-Phase Pipeline)*
*数据来源：项目代码库完整审查*
