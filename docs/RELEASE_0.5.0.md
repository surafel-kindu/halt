# Halt v0.5.0 — Release Notes

**Released:** 2026-07-15  
**Theme:** Sliding-window precision control at policy level (Python + TypeScript parity)

## Summary

This release exposes sliding-window precision as a first-class policy option in both SDKs.

- Python: `Policy.sliding_precision` (default `10`)
- TypeScript: `Policy.slidingPrecision` (default `10`)

This gives users direct control over sliding-window granularity:

- Higher precision => more accurate rolling-window behavior, more state/memory overhead
- Lower precision => coarser approximation, lower state/memory overhead

## Added

### Python

- Added `sliding_precision: int = 10` to `Policy`.
- Added validation: `sliding_precision must be positive`.
- Wired `Policy.sliding_precision` into in-process `SlidingWindow` construction.
- Included `sliding_precision` in in-process algorithm cache keys to avoid stale algorithm reuse when precision changes dynamically.

### TypeScript

- Added `slidingPrecision?: number` to `Policy`.
- `normalizePolicy` now defaults `slidingPrecision` to `10`.
- Added validation: `slidingPrecision` must be a positive integer.
- Wired `policy.slidingPrecision` into in-process `SlidingWindow` construction.
- Included `slidingPrecision` in in-process algorithm cache keys.

## Behavior Notes

- This setting affects the in-process sliding-window algorithm path.
- Redis atomic sliding-window behavior is unchanged in this release.

## Tests Updated

### Python

Updated `packages/python/tests/test_algorithm_cache.py`:

- Validates default `sliding_precision`.
- Validates rejection of non-positive `sliding_precision`.
- Verifies sliding precision participates in the in-process algorithm cache key.

### TypeScript

Updated `packages/typescript/tests/test_algorithm_cache.spec.ts`:

- Validates default `slidingPrecision` in normalized policy path.
- Validates rejection of invalid `slidingPrecision`.
- Verifies sliding precision participates in the in-process algorithm cache key.

## Demo Updated

- Python demo: `packages/python/examples/algorithms_demo.py`
  - Sliding-window run now demonstrates configurable precision (`sliding_precision=20`).
- TypeScript demo: `packages/typescript/examples/algorithms-demo.ts`
  - Sliding-window run now demonstrates configurable precision (`slidingPrecision=20`).
  - Fixed async usage by awaiting `limiter.check(...)`.

## Compatibility

- Backward-compatible and additive.
- Existing policies continue to work without changes.
