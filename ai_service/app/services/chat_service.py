"""Chat orchestration service - manages conversations and tool execution."""

import json
import uuid
from typing import Any
from app.llm.openai_provider import get_llm_provider
from app.tools.registry import get_tool_schemas, execute_tool
from app.tools.order_tools import register_order_tools
from app.tools.capacity_tools import register_capacity_tools

# Register all tools on import
register_order_tools()
register_capacity_tools()

SYSTEM_PROMPT = """你是中试AI助手，一个专门服务于中试生产管理的智能助理。你的职责包括：

## 核心能力
1. **订单进度查询**：帮助用户查询送样和实验订单的生产进度，包括当前工序、负责人、计划完成日期等
2. **产能负荷分析**：分析集团五大中试基地（广州、上海、成都、武汉、天津）的产能负荷情况
3. **下单推荐**：根据各基地当前负荷，智能推荐最优的下单基地
4. **交期估算**：估算新订单在各基地的预计交期

## 生产流程
订单从下单到完成的标准流程：
待排产 → 已排产 → 色粉开单 → 色粉称量 → 混料工序 → 挤出工序 → (颜色确认中 → 已入库) 或 (质检中 → 创建交货单/NG)

## 产能计算公式
- 日产能定额 = 设备台数 × 单台日标准产量
- 积压待产负荷率 = 待处理订单量 ÷ 日产能定额 × 100%
- 实时总负荷倍数 = 总待单量 ÷ 日产能定额
- 完工所需天数 = 待单量 ÷ 日产能定额

## 交互规范
- 使用中文回答
- 数据呈现清晰，善用表格和列表
- 涉及负荷分析时，主动给出推荐建议
- 如果信息不明确，主动询问用户补充
- 回答简洁专业，避免冗长"""


class ChatService:
    """Orchestrates AI conversations with tool calling."""

    def __init__(self):
        self.llm = get_llm_provider()
        self.conversations: dict[str, list[dict[str, Any]]] = {}

    def _get_or_create_conversation(self, conversation_id: str | None) -> tuple[str, list[dict[str, Any]]]:
        """Get existing conversation or create new one."""
        if conversation_id and conversation_id in self.conversations:
            return conversation_id, self.conversations[conversation_id]
        
        new_id = conversation_id or str(uuid.uuid4())
        self.conversations[new_id] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]
        return new_id, self.conversations[new_id]

    async def chat(
        self,
        message: str,
        conversation_id: str | None = None,
        user_id: str = "default",
    ) -> dict[str, Any]:
        """Process a chat message with tool calling support."""
        conv_id, messages = self._get_or_create_conversation(conversation_id)
        
        # Add user message
        messages.append({"role": "user", "content": message})
        
        tool_schemas = get_tool_schemas()
        tool_results = []
        max_iterations = 5  # Prevent infinite tool call loops
        
        for _ in range(max_iterations):
            response = await self.llm.chat_completion(
                messages=messages,
                tools=tool_schemas if tool_schemas else None,
            )
            
            # If no tool calls, we're done
            if "tool_calls" not in response:
                # Add assistant response to conversation
                messages.append({
                    "role": "assistant",
                    "content": response.get("content", ""),
                })
                
                return {
                    "conversation_id": conv_id,
                    "content": response.get("content", ""),
                    "tool_calls": None,
                    "tool_results": tool_results if tool_results else None,
                }
            
            # Process tool calls
            # Add assistant message with tool calls (OpenAI format)
            assistant_msg = {"role": "assistant", "content": response.get("content") or ""}
            if "tool_calls" in response:
                assistant_msg["tool_calls"] = [
                    {"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                    for tc in response["tool_calls"]
                ]
            messages.append(assistant_msg)
            
            for tc in response["tool_calls"]:
                # Execute tool
                result = await execute_tool(tc["name"], tc["arguments"])
                tool_results.append({
                    "tool_call_id": tc["id"],
                    "name": tc["name"],
                    "result": result,
                })
                
                # Add tool result to messages
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, ensure_ascii=False),
                })
        
        # If we hit max iterations
        return {
            "conversation_id": conv_id,
            "content": "抱歉，处理过程中遇到了问题，请尝试简化您的请求。",
            "tool_calls": None,
            "tool_results": tool_results,
        }

    async def chat_stream(
        self,
        message: str,
        conversation_id: str | None = None,
        user_id: str = "default",
    ):
        """Process a chat message with streaming output."""
        conv_id, messages = self._get_or_create_conversation(conversation_id)
        messages.append({"role": "user", "content": message})
        
        tool_schemas = get_tool_schemas()
        
        # First, try non-streaming to check for tool calls
        response = await self.llm.chat_completion(
            messages=messages,
            tools=tool_schemas if tool_schemas else None,
        )
        
        if "tool_calls" in response:
            # Execute tools and then stream the final response
            assistant_msg = {"role": "assistant", "content": response.get("content") or ""}
            assistant_msg["tool_calls"] = [
                {"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                for tc in response["tool_calls"]
            ]
            messages.append(assistant_msg)
            
            for tc in response["tool_calls"]:
                result = await execute_tool(tc["name"], tc["arguments"])
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, ensure_ascii=False),
                })
                yield {
                    "type": "tool_result",
                    "tool_call_id": tc["id"],
                    "name": tc["name"],
                    "result": result,
                }
        
        # Stream the final response
        full_content = ""
        async for chunk in self.llm.chat_completion_stream(messages=messages):
            if chunk["type"] == "text":
                full_content += chunk["content"]
                yield chunk
        
        messages.append({"role": "assistant", "content": full_content})
        yield {"type": "done", "conversation_id": conv_id}


# Singleton instance
chat_service = ChatService()
