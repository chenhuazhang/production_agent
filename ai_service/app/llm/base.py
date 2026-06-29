from abc import ABC, abstractmethod
from typing import Any


class BaseLLMProvider(ABC):
    """Base class for LLM providers."""

    @abstractmethod
    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Send a chat completion request and return the response."""
        pass

    @abstractmethod
    async def chat_completion_stream(
        self,
        messages: list[dict[str, str]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
    ):
        """Send a streaming chat completion request."""
        pass
