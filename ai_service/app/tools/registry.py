"""Tool registry for AI function calling."""

from typing import Any, Callable, Awaitable
import json

# Type for async tool functions
ToolFunction = Callable[..., Awaitable[Any]]

# Registry storage
_tool_registry: dict[str, dict[str, Any]] = {}
_tool_functions: dict[str, ToolFunction] = {}


def register_tool(
    name: str,
    description: str,
    parameters: dict[str, Any],
    func: ToolFunction,
):
    """Register a tool with its schema and implementation."""
    _tool_registry[name] = {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }
    _tool_functions[name] = func


def get_tool_schemas() -> list[dict[str, Any]]:
    """Get all registered tool schemas for LLM function calling."""
    return list(_tool_registry.values())


async def execute_tool(name: str, arguments: str | dict) -> dict[str, Any]:
    """Execute a registered tool by name."""
    if name not in _tool_functions:
        return {"error": f"Unknown tool: {name}", "success": False}
    
    try:
        if isinstance(arguments, str):
            arguments = json.loads(arguments)
        result = await _tool_functions[name](**arguments)
        return {"result": result, "success": True}
    except Exception as e:
        return {"error": str(e), "success": False}


def get_tool_names() -> list[str]:
    """Get all registered tool names."""
    return list(_tool_registry.keys())
