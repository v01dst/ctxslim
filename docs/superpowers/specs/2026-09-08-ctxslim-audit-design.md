# CtxSlim Audit — Design Spec (v0.4.0)

Date: 2026-09-08. Status: approved by user in brainstorming; precedes implementation plan.

## Goal

Meter MCP-attributable token spend (tool definitions per request + every tool
result + errors + duplicate calls) and report it per task in dollars across
multiple model families — so the user sees exactly where tokens and money burn
without giving up any tool power. Phase 2 (savers) is designed afterwards from
real audit data.

## Non-goals

- Metering the model's own input/output text (invisible from the proxy).
- True LLM-turn boundaries (invisible from the proxy; idle-gap bursts instead).
- Real-time dashboards, cloud upload, cross-machine sync.
- Changing any proxy behavior: metering is append-only observation.

## Architecture

A metering hook in `ContextSlimServer.handleCallTool` appends one JSON line per
proxied call to `audit.jsonl` in the stats dir (`~/.ctxslim`, overridable via
`CTX_SLIM_STATS_DIR`). A new `ctxslim audit` CLI command reads `audit.jsonl`
(+ existing `stats.jsonl` for per-session definition sizes), segments calls
into tasks, prices them with a built-in table, and renders human/`--json`
reports. All computation is offline at audit time; the proxy path gains one
file append per call.

## Components

### 1. Metering record (`src/server.ts`, `src/config.ts`)

Per upstream tool call, append:

```json
{ "ts": 1757..., "session": "<startedAt ISO>", "server": "playwright",
  "tool": "browser_screenshot", "argsHash": "sha1:<20 bytes hex>",
  "reqChars": 48, "outChars": 91204, "isError": false, "durationMs": 812 }
```

- `argsHash` is SHA-1 over canonical JSON of args; raw args are never stored.
- Only sizes, hashes, names, timings — no payload content.
- Written only when `statsEnabled` is true (`--no-stats` disables metering,
  consistent with `stats.jsonl`/`usage.json` behavior in v0.3.1).
- Meta-tool calls (`search_tools`, etc.) are not metered; only upstream calls.
- Overhead: one `appendFileSync` per call, negligible next to process spawn
  and network latency.

### 2. Task segmentation (audit time)

Calls are grouped per session, split into tasks wherever the gap between
consecutive calls exceeds `--gap` seconds (default 120). A task record holds:
call count, duration, per-server/per-tool out-char totals, error count,
duplicate groups (same server + tool + argsHash, count > 1). Segmentation is
purely a read-time operation, so the gap can be re-sliced freely.

### 3. Pricing (`src/pricing.ts`)

Built-in table, one row per model family: `{ family, inputPer1M, outputPer1M,
cacheReadPer1M?, cacheWritePer1M?, asOf }`. Families: Claude Sonnet, Claude
Opus, GPT flagship, Gemini flagship, Gemini flash-class. `asOf` date stamped;
`--prices <json>` overrides/adds rows. Prices are indicative (list prices at
time of release); the report labels them as estimates.

Pricing rules:

- Tool outputs are priced as INPUT tokens (they return as user messages).
- Definitions (per-session `tokensAfter` from `stats.jsonl`) are reported as a
  steady-state burn rate ($ per request), shown twice: full price and
  prompt-cached price (Anthropic caches the tools block).
- The model's own tokens are excluded and the report states this.

### 4. Report (`ctxslim audit`)

`ctxslim audit [--gap 120] [--model <family>] [--prices <file>] [--json]`

Human output sections:

- Headline: period totals (tasks, calls, tool-output $ across families),
  definitions $/request (full + cached), duplicate waste $, error waste $.
- Top tasks: id, calls, duration, dominant server, $ (in `--model` family,
  or Claude Sonnet when omitted).
- Top tools: calls, out-tokens, duplicates, errors, $.
- Waste: duplicate groups (server::tool, argsHash prefix, count, $ burned)
  and error burns (server::tool, count, $ burned).
- A `--model` flag headlines one family; without it the headline shows all
  families (the user switches models between sessions), and per-row $ figures
  use Claude Sonnet (first table row) unless `--model` says otherwise.
- `--json` emits `{ summary, tasks, tools, waste, definitions }`.
- Empty state: guidance when no `audit.jsonl` exists yet.

### 5. Data flow

```
tools/call → handleCallTool → append audit.jsonl (sizes/hash/error/timing)
ctxslim audit → read audit.jsonl + stats.jsonl → segment --gap → price →
human table or --json
```

## Error handling

- Metering failures never break calls: the append is wrapped in try/catch and
  degrades to a no-op (same convention as `saveSessionStats`).
- Corrupt `audit.jsonl` lines are skipped with a stderr warning count.
- Missing files produce the empty-state message, not an error.

## Testing

- Unit: arg-hash stability/canonicalization; segmentation on synthetic streams
  (gap boundaries, single-call tasks, cross-session isolation); pricing math
  incl. cached-vs-full definitions; `--json` shape.
- Integration: proxied calls produce well-formed audit lines (sizes > 0,
  hash matches recomputation, isError on failing tools); `--no-stats`
  produces no file.
- No network, no clock dependence (inject timestamps in unit tests).

## Phase 2 preview (not in scope)

The waste section is the Phase 2 backlog: duplicates → result memoization /
dedup-by-reference; definitions $/request → progressive disclosure (minimal
tools/list + on-demand schemas); image-heavy servers → screenshot
downsampling; error burns → loop guards; aggregate patterns → auto-tune
(`ctxslim doctor --tune`). Designed after audit data exists.

## Decisions locked in brainstorming

- Proxy-side metering over client-side tracking or estimation.
- Dollar estimates with a multi-family price table, not tokens-only.
- Per-task (idle-gap bursts) granularity; no claim of LLM-turn accuracy.
- `--no-stats` disables metering; hashes not raw args; local-only files.
