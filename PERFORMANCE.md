# Rāma AGI — Performance Specification

## Idle resource footprint (app running, no active tasks)

| Component | RAM | CPU | Interval | Notes |
|---|---|---|---|---|
| Electron shell | ~80MB | <0.1% | — | Always |
| React UI | ~60MB | <0.1% | — | Always |
| Express server | ~15MB | <0.1% | — | Always |
| ramaEventBus | ~5MB | negligible | event-driven | Always |
| ipcEncryption | ~1MB | negligible | per-message | Always |
| nucleusSealer | ~2MB | negligible | on auth only | Always (after seal) |
| dataStore | ~10MB | negligible | auto-save 60s | Always |
| sessionManager | ~3MB | negligible | — | Always |
| **Total idle** | **~176MB** | **<0.5%** | — | — |

## Background loops (post-authentication, master session active)

| Loop | RAM | CPU | Interval | Adaptive? |
|---|---|---|---|---|
| resourceOrchestrator snapshot | ~8MB | <0.5% | **Adaptive: 3–15s** | ✅ Slows under pressure |
| selfCare health sweep | ~5MB | <0.3% | 120s | ✅ Only when active |
| consciousness loop | ~3MB | <0.2% | 60s (staggered +15s) | ✅ Only if master auth |
| dataStore auto-save | negligible | <0.1% | 60s | — |
| **Total background** | **~16MB extra** | **<1%** | — | — |

## On-demand engines (only activate when used, release when idle)

| Engine | Peak RAM | Peak CPU | Auto-release |
|---|---|---|---|
| browserEngine (Playwright) | +200MB | medium | ✅ 5min inactivity auto-close |
| sandboxEngine (child proc) | +256MB per exec | high burst | ✅ On completion |
| agentOrchestrator agents | +512MB per agent | variable | ✅ On completion or timeout |
| vectorMemory (vectra) | +50–100MB | low | — (persistent, capped 2000 entries) |
| astEngine | +15MB cache | low | — (LRU cache) |
| modelRouter AI calls | 0 (network only) | near-zero | — |
| evolutionEngine scouts | 0 (network only) | low | — |

## Performance principles

1. **Adaptive polling** — resourceOrchestrator adjusts its own interval (3s active → 15s critical)
2. **Browser auto-close** — Playwright releases ~200MB after 5min idle
3. **Staggered intervals** — loops start at t+15s to prevent burst at t=0
4. **Auth-gated loops** — consciousness loop only runs when master is authenticated
5. **Keyword fallback cap** — vectorMemory keyword store capped at 2,000 entries (~2MB)
6. **Sandbox cleanup** — tmp files deleted on completion AND on crash (process exit hook)
7. **Agent timeout** — all agents auto-kill after 5min (GOVERNOR.AGENT_TIMEOUT_MS)
8. **Circuit breakers** — API calls stop after 4 failures, resume after 20s
9. **LRU caches** — astEngine and vectorMemory both use bounded caches

## Resource pressure response

| Pressure | CPU | RAM | Rāma's response |
|---|---|---|---|
| Optimal | <50% | <50% | Full capability, all workers active |
| Moderate | 50–70% | 50–75% | Reduce to 60% of max workers, slow background |
| High | 70–85% | 75–88% | Only HIGH+ priority tasks, pause BACKGROUND |
| Critical | >85% | >88% | 1 worker only, CRITICAL tasks only, alert master |

## Total peak footprint (fully loaded)

Worst case: Electron + UI + server + all engines + 1 agent + browser open

| Layer | RAM |
|---|---|
| Base (always) | ~176MB |
| Background loops | ~16MB |
| browserEngine active | +200MB |
| 1 agent active | +512MB |
| vectorMemory | +100MB |
| Other caches | +50MB |
| **TOTAL PEAK** | **~1.05GB** |

This is well within what modern machines handle. VS Code itself uses 500MB–1GB.
On a machine with 8GB+ RAM, Rāma at full load uses ~13% of memory.
On 16GB: ~6.5%.

## Comparison with typical apps

| App | Typical RAM |
|---|---|
| VS Code | 400–800MB |
| Chrome (3 tabs) | 600MB–1.2GB |
| Slack | 300–500MB |
| **Rāma AGI (idle)** | **~176MB** |
| **Rāma AGI (full load)** | **~1GB** |

Rāma idle is lighter than Slack. Full load is equivalent to Chrome with 3 tabs.
