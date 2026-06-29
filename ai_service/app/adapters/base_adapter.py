from abc import ABC, abstractmethod
from typing import Any


class BaseAdapter(ABC):
    """Abstract adapter for business database access (read-only)."""

    @abstractmethod
    async def get_order_by_no(self, order_no: str) -> dict[str, Any] | None:
        """Get order details by order number."""
        pass

    @abstractmethod
    async def search_orders(self, keyword: str) -> list[dict[str, Any]]:
        """Search orders by keyword (customer, product, order number)."""
        pass

    @abstractmethod
    async def get_order_stages(self, order_no: str) -> list[dict[str, Any]]:
        """Get all production stages for an order."""
        pass

    @abstractmethod
    async def get_pending_orders_by_base(self, base_name: str) -> int:
        """Get count of pending orders for a specific base."""
        pass

    @abstractmethod
    async def get_all_pending_orders_summary(self) -> list[dict[str, Any]]:
        """Get summary of all pending orders grouped by base."""
        pass
