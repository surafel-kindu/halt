"""Quota management for SaaS platforms."""

import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional
from datetime import datetime, timedelta


class QuotaPeriod(str, Enum):
    """Quota reset period."""
    HOURLY = "hourly"
    DAILY = "daily"
    MONTHLY = "monthly"
    YEARLY = "yearly"


@dataclass
class Quota:
    """Quota configuration.
    
    Attributes:
        name: Quota name
        limit: Maximum usage allowed
        period: Reset period (hourly, daily, monthly, yearly)
        current_usage: Current usage count
        reset_at: Timestamp when quota resets
    """
    name: str
    limit: int
    period: QuotaPeriod
    current_usage: int = 0
    reset_at: Optional[int] = None
    
    def __post_init__(self) -> None:
        """Initialize reset_at if not provided."""
        if self.reset_at is None:
            self.reset_at = self._calculate_reset_time()
    
    def _calculate_reset_time(self) -> int:
        """Calculate next reset time based on period."""
        now = datetime.utcnow()
        
        if self.period == QuotaPeriod.HOURLY:
            next_reset = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        elif self.period == QuotaPeriod.DAILY:
            next_reset = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        elif self.period == QuotaPeriod.MONTHLY:
            # Next month, first day
            if now.month == 12:
                next_reset = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            else:
                next_reset = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
        elif self.period == QuotaPeriod.YEARLY:
            next_reset = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            raise ValueError(f"Invalid quota period: {self.period}")
        
        return int(next_reset.timestamp())
    
    def is_expired(self) -> bool:
        """Check if quota period has expired."""
        return int(time.time()) >= self.reset_at
    
    def reset(self) -> None:
        """Reset quota usage and update reset time."""
        self.current_usage = 0
        self.reset_at = self._calculate_reset_time()
    
    def remaining(self) -> int:
        """Get remaining quota."""
        return max(0, self.limit - self.current_usage)
    
    def is_exceeded(self) -> bool:
        """Check if quota is exceeded."""
        return self.current_usage >= self.limit


class QuotaManager:
    """Manage quotas for users/keys."""
    
    def __init__(self, store: Any, telemetry: Optional[Any] = None) -> None:
        """Initialize quota manager.

        Args:
            store: Storage backend (any store with get/set methods)
            telemetry: Optional TelemetryHooks for observability
        """
        self.store = store
        self.telemetry = telemetry
    
    def _get_quota_key(self, identifier: str, quota_name: str) -> str:
        """Generate storage key for quota.
        
        Args:
            identifier: User ID, API key, or other identifier
            quota_name: Name of the quota
            
        Returns:
            Storage key
        """
        return f"halt:quota:{quota_name}:{identifier}"
    
    def get_quota(self, identifier: str, quota: Quota) -> Quota:
        """Get current quota state.
        
        Args:
            identifier: User ID, API key, or other identifier
            quota: Quota configuration
            
        Returns:
            Current quota state
        """
        key = self._get_quota_key(identifier, quota.name)
        stored = self.store.get(key)
        
        if stored is None:
            # Initialize new quota
            return Quota(
                name=quota.name,
                limit=quota.limit,
                period=quota.period,
                current_usage=0
            )
        
        # Deserialize stored quota
        current_quota = Quota(
            name=stored.get("name", quota.name),
            limit=stored.get("limit", quota.limit),
            period=QuotaPeriod(stored.get("period", quota.period)),
            current_usage=stored.get("current_usage", 0),
            reset_at=stored.get("reset_at")
        )
        
        # Check if quota period expired
        if current_quota.is_expired():
            current_quota.reset()
        
        return current_quota
    
    def check_quota(
        self,
        identifier: str,
        quota: Quota,
        cost: int = 1
    ) -> tuple[bool, Quota]:
        """Check if quota allows the operation.
        
        Args:
            identifier: User ID, API key, or other identifier
            quota: Quota configuration
            cost: Cost of the operation (default: 1)
            
        Returns:
            Tuple of (allowed, current_quota)
        """
        current_quota = self.get_quota(identifier, quota)

        # Check if adding cost would exceed quota
        allowed = (current_quota.current_usage + cost) <= current_quota.limit

        if self.telemetry:
            self.telemetry.on_quota_check(identifier, current_quota, allowed)
            if not allowed:
                self.telemetry.on_quota_exceeded(identifier, current_quota)

        return allowed, current_quota
    
    def consume_quota(
        self,
        identifier: str,
        quota: Quota,
        cost: int = 1
    ) -> Quota:
        """Consume quota and update storage.
        
        Args:
            identifier: User ID, API key, or other identifier
            quota: Quota configuration
            cost: Cost of the operation (default: 1)
            
        Returns:
            Updated quota
        """
        current_quota = self.get_quota(identifier, quota)
        
        # Increment usage
        current_quota.current_usage += cost
        
        # Save to storage
        key = self._get_quota_key(identifier, quota.name)
        ttl = current_quota.reset_at - int(time.time()) + 3600  # Add 1 hour buffer
        
        self.store.set(
            key,
            {
                "name": current_quota.name,
                "limit": current_quota.limit,
                "period": current_quota.period.value,
                "current_usage": current_quota.current_usage,
                "reset_at": current_quota.reset_at
            },
            ttl=ttl
        )
        
        return current_quota
    
    def reset_quota(self, identifier: str, quota: Quota) -> None:
        """Manually reset quota.
        
        Args:
            identifier: User ID, API key, or other identifier
            quota: Quota configuration
        """
        key = self._get_quota_key(identifier, quota.name)
        self.store.delete(key)


# Preset quotas for common SaaS tiers
QUOTA_FREE_MONTHLY = Quota(
    name="free_monthly_requests",
    limit=10000,
    period=QuotaPeriod.MONTHLY
)

QUOTA_PRO_MONTHLY = Quota(
    name="pro_monthly_requests",
    limit=100000,
    period=QuotaPeriod.MONTHLY
)

QUOTA_ENTERPRISE_MONTHLY = Quota(
    name="enterprise_monthly_requests",
    limit=1000000,
    period=QuotaPeriod.MONTHLY
)

QUOTA_FREE_DAILY = Quota(
    name="free_daily_requests",
    limit=500,
    period=QuotaPeriod.DAILY
)

QUOTA_PRO_DAILY = Quota(
    name="pro_daily_requests",
    limit=5000,
    period=QuotaPeriod.DAILY
)
