# Halt v0.3.0 — Release Notes & Docs Handoff

**Released:** 2026-06-24 · `halt-rate` 0.3.0 on [npm](https://www.npmjs.com/package/halt-rate) and [PyPI](https://pypi.org/project/halt-rate/).
**Theme:** SaaS positioning + built-in observability + distributed correctness testing.
**Compatibility:** Additive and backward-compatible — no breaking changes.

This doc is for two audiences: (A) a CHANGELOG entry, and (B) the documentation website
session (what to add/update). It follows the v0.2.0 Redis handoff (`docs/REDIS_SUPPORT_CHANGES.md`).

---

## CHANGELOG (copy-paste)

```markdown
## [0.3.0] — 2026-06-24

### Added
- **Observability**: pass a `telemetry` hook to the limiter and Halt reports every
  rate-limited check with rich metadata (policy, algorithm, endpoint, cost, plan).
  - `StatsCollector` — zero-dependency in-process aggregator: blocked/allowed totals,
    per-policy & per-endpoint breakdowns, top-N limited users/keys, endpoint cost usage,
    and per-plan consumption. Exposes `snapshot()` (and `reset()`) for a `/halt/stats` endpoint.
  - `OpenTelemetryMetrics` — OTel metrics adapter (counters `halt.requests`, `halt.blocked`,
    `halt.cost`, `halt.quota.exceeded`, `halt.penalty.applied`). Dependency-free via an
    injected meter; optional `@opentelemetry/api` / `opentelemetry-api`.
  - `QuotaManager` and `PenaltyManager` now accept an optional telemetry hook and emit
    quota/penalty/violation events.
- `Policy.plan` — optional plan/tier label used for observability tagging; set on the
  `PLAN_*` presets.
- First-class exports from the package root: `QuotaManager`, `PenaltyManager`, telemetry
  classes, quota/penalty presets, `StatsCollector`, `OpenTelemetryMetrics`
  (previously only deep-importable).

### Changed
- Sharper package positioning (description + keywords): "SaaS-aware, cross-language rate limiting".
- READMEs slimmed to a minimal quick-start that links to the docs site.

### Tests
- New `REDIS_URL`-gated distributed correctness suites (both languages): 100+ concurrent
  across all four algorithms, real multi-process workers, token/leaky races, sliding-window
  boundary, and window reset. Plus pure `StatsCollector` unit tests.

### Dependencies
- Optional: `@opentelemetry/api` (TS peer) / `opentelemetry-api` (Python `otel` extra).
```

---

## New public API (for the docs site)

### Limiter option
Both languages: a new optional `telemetry` argument on the limiter.

```ts
// TypeScript
new RateLimiter({ store, policy, telemetry });
```
```python
# Python
RateLimiter(store=store, policy=policy, telemetry=telemetry)
```

The hook receives, per rate-limited check, metadata:
`{ policy, algorithm, keyStrategy, endpoint, cost, plan }` (snake_case in Python).

### `StatsCollector` (zero-dependency)
Exported from the package root in both languages.

```ts
import { RateLimiter, StatsCollector } from 'halt-rate';
const stats = new StatsCollector({ topN: 20, maxTrackedKeys: 10000 });
const limiter = new RateLimiter({ store, policy, telemetry: stats });
app.get('/halt/stats', (_req, res) => res.json(stats.snapshot()));
```
```python
from halt import RateLimiter, StatsCollector
stats = StatsCollector(top_n=20, max_tracked_keys=10000)
limiter = RateLimiter(store=store, policy=policy, telemetry=stats)

@app.get("/halt/stats")
def halt_stats():
    return stats.snapshot()
```

`snapshot()` fields (TS camelCase / Python snake_case):
`allowedTotal`, `blockedTotal`, `byPolicy`, `byEndpoint` (incl. `cost`),
`topLimitedKeys` ([{key, blocked}], descending), `costByPlan`, `quotaExceeded`,
`penaltiesApplied`, `violations`, `trackedKeys`. Also `reset()`.

Notes to document: it is **per-process** (run on each instance; aggregate across the fleet
with OTel/Prometheus). Memory is bounded — the tracked-key table is capped and the smallest
counters are evicted. Blocked requests do not add to cost (cost = consumed/allowed).

### `OpenTelemetryMetrics`
```ts
import { metrics } from '@opentelemetry/api';
import { OpenTelemetryMetrics } from 'halt-rate';
const telemetry = new OpenTelemetryMetrics(metrics.getMeter('halt'));
```
```python
from opentelemetry import metrics
from halt import OpenTelemetryMetrics
telemetry = OpenTelemetryMetrics(meter=metrics.get_meter("halt"))  # or OpenTelemetryMetrics() to auto-acquire
```
Combine multiple hooks with `CompositeTelemetry` (e.g. `StatsCollector` + `OpenTelemetryMetrics`).
Request **spans** remain separate via the limiter's existing `otelTracer` / `otel_tracer`.

### `Policy.plan`
Optional `plan` (TS) / `plan=` (Python) field on a policy; the `PLAN_*` presets now set it
("free", "starter", "pro", "business", "enterprise"). Used for per-plan metrics/quota tagging;
falls back to the policy name when unset.

### Newly root-exported (were deep-import only)
`QuotaManager`, `Quota`, `QuotaPeriod`, the `QUOTA_*` presets; `PenaltyManager`, `Penalty`,
`PenaltyConfig`, the `PENALTY_*` presets; `TelemetryHooks`, `LoggingTelemetry`,
`MetricsTelemetry`, `CompositeTelemetry`. Update any docs that deep-imported from
`halt/core/*` or `../src/core/*` to use the package root.

---

## Documentation site — what to add/update

1. **New "Observability" page/section** covering:
   - the `telemetry` option and the metadata it emits,
   - `StatsCollector` (snapshot fields, `/halt/stats` example, per-process caveat),
   - `OpenTelemetryMetrics` (counters list, injected vs auto-acquired meter),
   - composing hooks with `CompositeTelemetry`,
   - distinction from the existing `otelTracer` spans.
2. **SaaS pages**: now that quota/penalty/telemetry are root exports, switch examples to
   public imports; mention `Policy.plan` and per-plan metrics.
3. **Quotas/Penalties pages**: document the optional `telemetry` argument on `QuotaManager`
   and `PenaltyManager` and the events they emit (`on_quota_check`/`on_quota_exceeded`,
   `on_penalty_applied`/`on_violation`).
4. **Install/optional-deps pages**: add OTel — `npm install @opentelemetry/api` /
   `pip install "halt-rate[otel]"`.
5. **Homepage/positioning**: align with the new tagline — "SaaS-aware, cross-language rate
   limiting" (users / API keys / plans / quotas / weighted endpoints / abuse controls /
   atomic Redis / observability).
6. **Note for README↔site**: the package READMEs are now intentionally minimal and link to
   the site, so the site is the single source of truth for detailed usage.

---

## Verification (already run pre-release)
- TS: build (ESM+CJS+DTS) + 27 tests pass; 8 distributed tests pass against a real Redis.
- Python: 30 tests pass (incl. multiprocessing distributed); `python -m build` + `twine check` pass.
- Both 0.3.0 artifacts published and verified live on npm (with provenance) and PyPI.
