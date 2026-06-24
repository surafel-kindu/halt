"""Penalty system for abuse detection and progressive rate limiting."""

import time
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class PenaltyConfig:
    """Penalty configuration.
    
    Attributes:
        threshold: Abuse score threshold to trigger penalty
        duration: Penalty duration in seconds
        multiplier: Rate limit multiplier (e.g., 0.5 = half the normal limit)
        decay_rate: How fast abuse score decays (points per hour)
    """
    threshold: int = 10
    duration: int = 3600  # 1 hour
    multiplier: float = 0.5  # Reduce limit to 50%
    decay_rate: float = 1.0  # 1 point per hour


@dataclass
class Penalty:
    """Active penalty state.
    
    Attributes:
        abuse_score: Current abuse score
        penalty_until: Timestamp when penalty expires (None if no penalty)
        violations: Number of violations recorded
        last_violation: Timestamp of last violation
    """
    abuse_score: float = 0.0
    penalty_until: Optional[int] = None
    violations: int = 0
    last_violation: Optional[int] = None
    
    def is_active(self) -> bool:
        """Check if penalty is currently active."""
        if self.penalty_until is None:
            return False
        return int(time.time()) < self.penalty_until
    
    def time_remaining(self) -> int:
        """Get remaining penalty time in seconds."""
        if not self.is_active():
            return 0
        return self.penalty_until - int(time.time())


class PenaltyManager:
    """Manage penalties and abuse scores."""
    
    def __init__(
        self,
        store: Any,
        config: Optional[PenaltyConfig] = None,
        telemetry: Optional[Any] = None,
    ) -> None:
        """Initialize penalty manager.

        Args:
            store: Storage backend (any store with get/set methods)
            config: Penalty configuration (uses defaults if not provided)
            telemetry: Optional TelemetryHooks for observability
        """
        self.store = store
        self.config = config or PenaltyConfig()
        self.telemetry = telemetry
    
    def _get_penalty_key(self, identifier: str) -> str:
        """Generate storage key for penalty.
        
        Args:
            identifier: User ID, API key, or IP address
            
        Returns:
            Storage key
        """
        return f"halt:penalty:{identifier}"
    
    def get_penalty(self, identifier: str) -> Penalty:
        """Get current penalty state.
        
        Args:
            identifier: User ID, API key, or IP address
            
        Returns:
            Current penalty state
        """
        key = self._get_penalty_key(identifier)
        stored = self.store.get(key)
        
        if stored is None:
            return Penalty()
        
        penalty = Penalty(
            abuse_score=stored.get("abuse_score", 0.0),
            penalty_until=stored.get("penalty_until"),
            violations=stored.get("violations", 0),
            last_violation=stored.get("last_violation")
        )
        
        # Apply decay to abuse score
        if penalty.last_violation:
            hours_elapsed = (time.time() - penalty.last_violation) / 3600
            decay = hours_elapsed * self.config.decay_rate
            penalty.abuse_score = max(0, penalty.abuse_score - decay)
        
        return penalty
    
    def record_violation(
        self,
        identifier: str,
        severity: float = 1.0
    ) -> Penalty:
        """Record a rate limit violation.
        
        Args:
            identifier: User ID, API key, or IP address
            severity: Violation severity (default: 1.0)
            
        Returns:
            Updated penalty state
        """
        penalty = self.get_penalty(identifier)
        
        # Increment abuse score
        penalty.abuse_score += severity
        penalty.violations += 1
        penalty.last_violation = int(time.time())
        
        # Check if penalty should be applied
        penalty_triggered = False
        if penalty.abuse_score >= self.config.threshold and not penalty.is_active():
            penalty.penalty_until = int(time.time()) + self.config.duration
            penalty_triggered = True

        # Save to storage
        self._save_penalty(identifier, penalty)

        if self.telemetry:
            self.telemetry.on_violation(identifier, penalty, severity)
            if penalty_triggered:
                self.telemetry.on_penalty_applied(identifier, penalty)

        return penalty

    def apply_penalty(self, identifier: str, duration: Optional[int] = None) -> Penalty:
        """Manually apply a penalty.
        
        Args:
            identifier: User ID, API key, or IP address
            duration: Penalty duration in seconds (uses config default if not provided)
            
        Returns:
            Updated penalty state
        """
        penalty = self.get_penalty(identifier)
        
        if duration is None:
            duration = self.config.duration
        
        penalty.penalty_until = int(time.time()) + duration

        # Save to storage
        self._save_penalty(identifier, penalty)

        if self.telemetry:
            self.telemetry.on_penalty_applied(identifier, penalty)

        return penalty

    def clear_penalty(self, identifier: str) -> None:
        """Clear penalty for an identifier.
        
        Args:
            identifier: User ID, API key, or IP address
        """
        key = self._get_penalty_key(identifier)
        self.store.delete(key)
    
    def get_rate_limit_multiplier(self, identifier: str) -> float:
        """Get rate limit multiplier based on penalty status.
        
        Args:
            identifier: User ID, API key, or IP address
            
        Returns:
            Multiplier to apply to rate limit (1.0 = normal, 0.5 = half)
        """
        penalty = self.get_penalty(identifier)
        
        if penalty.is_active():
            return self.config.multiplier
        
        return 1.0
    
    def _save_penalty(self, identifier: str, penalty: Penalty) -> None:
        """Save penalty to storage.
        
        Args:
            identifier: User ID, API key, or IP address
            penalty: Penalty state to save
        """
        key = self._get_penalty_key(identifier)
        
        # Calculate TTL (keep data for 7 days after last violation)
        ttl = 7 * 24 * 3600
        
        self.store.set(
            key,
            {
                "abuse_score": penalty.abuse_score,
                "penalty_until": penalty.penalty_until,
                "violations": penalty.violations,
                "last_violation": penalty.last_violation
            },
            ttl=ttl
        )


# Preset penalty configurations
PENALTY_LENIENT = PenaltyConfig(
    threshold=20,
    duration=1800,  # 30 minutes
    multiplier=0.75,
    decay_rate=2.0
)

PENALTY_MODERATE = PenaltyConfig(
    threshold=10,
    duration=3600,  # 1 hour
    multiplier=0.5,
    decay_rate=1.0
)

PENALTY_STRICT = PenaltyConfig(
    threshold=5,
    duration=7200,  # 2 hours
    multiplier=0.25,
    decay_rate=0.5
)
