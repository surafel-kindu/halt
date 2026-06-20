"""FastAPI middleware adapter for Halt rate limiting."""

from typing import Callable, Optional
from fastapi import Request, Response, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from halt.core.limiter import RateLimiter


class HaltMiddleware(BaseHTTPMiddleware):
    """FastAPI/Starlette middleware for rate limiting."""
    
    def __init__(
        self,
        app: ASGIApp,
        limiter: RateLimiter,
        on_blocked: Optional[Callable[[Request], Response]] = None,
    ) -> None:
        """Initialize middleware.
        
        Args:
            app: ASGI application
            limiter: RateLimiter instance
            on_blocked: Optional callback for custom blocked response
        """
        super().__init__(app)
        self.limiter = limiter
        self.on_blocked = on_blocked
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request through rate limiter.
        
        Args:
            request: Incoming request
            call_next: Next middleware/handler
        
        Returns:
            Response
        """
        # Check rate limit (async path supports async Redis stores)
        decision = await self.limiter.acheck(request)

        # Add rate limit headers to response
        if decision.allowed:
            response = await call_next(request)
            for key, value in decision.to_headers().items():
                response.headers[key] = value
            return response
        else:
            # Request blocked
            if self.on_blocked:
                return self.on_blocked(request)
            
            # Default 429 response
            headers = decision.to_headers()
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": "Too many requests. Please try again later.",
                    "retry_after": decision.retry_after,
                },
                headers=headers,
            )


def create_limiter_dependency(limiter: RateLimiter) -> Callable:
    """Create a FastAPI dependency for rate limiting specific endpoints.
    
    Args:
        limiter: RateLimiter instance
    
    Returns:
        Dependency function
    
    Example:
        ```python
        from fastapi import Depends
        
        rate_limit = create_limiter_dependency(limiter)
        
        @app.get("/api/data", dependencies=[Depends(rate_limit)])
        async def get_data():
            return {"data": "..."}
        ```
    """
    def dependency(request: Request) -> None:
        decision = limiter.check(request)
        if not decision.allowed:
            headers = decision.to_headers()
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": "Too many requests. Please try again later.",
                    "retry_after": decision.retry_after,
                },
                headers=headers,
            )

    return dependency


def create_async_limiter_dependency(limiter: RateLimiter) -> Callable:
    """Create an async FastAPI dependency (use with an async Redis store).

    Args:
        limiter: RateLimiter instance backed by an ``AsyncRedisStore``.

    Returns:
        An async dependency function.

    Example:
        ```python
        from fastapi import Depends

        rate_limit = create_async_limiter_dependency(limiter)

        @app.get("/api/data", dependencies=[Depends(rate_limit)])
        async def get_data():
            return {"data": "..."}
        ```
    """

    async def dependency(request: Request) -> None:
        decision = await limiter.acheck(request)
        if not decision.allowed:
            headers = decision.to_headers()
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": "Too many requests. Please try again later.",
                    "retry_after": decision.retry_after,
                },
                headers=headers,
            )

    return dependency
