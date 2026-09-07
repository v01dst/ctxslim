# CtxSlim — Design Spec

Date: 2026-09-07
Status: Approved (compressed approval via chat)

## Problem

MCP clients inject every connected server's full tool schemas into the LLM
context. With 3-4 servers installed this wastes 20-50k tokens per conversation
before the user asks anything. Documented developer pain: "context bloat",
slower responses, higher cost, degraded tool-call accuracy.

## Solution

CtxSlim is a zero-config MCP proxy. The client connects to CtxSlim
instead of the individual servers; CtxSlim connects to all configured
servers upstream and presents one unified, dynamically-filtered surface.

Key properties:
- 100% local: no API keys, no network calls beyond the upstream MCP servers.
- Drop-in: one entry in the MCP config (`npx -y ctxslim`).
- Zero config: auto-discovers servers from the client's own config file.

## Architecture

TypeScript / Node (ESM). Distribution: npm package `ctxslim`.

```
src/
  index.ts        CLI entry (bin). Subcommands: `ctxslim`, `ctxslim stats`, `--help`
  server.ts       ProxyServer: MCP server facing the client + connections to upstreams
  config.ts       Config loader: reads existing client config (claude/cursor/etc) or CTX_SLIM_CONFIG
  ranker.ts       Relevance engine: BM25-ish lexical scoring over tool names/descriptions
                  + recency of use. Picks top-K tools per turn.
  compressor.ts   Schema compressor: strips less-used properties from JSON Schemas,
                  trims descriptions, measures savings.
  meta.ts         Meta-tools exposed to the client: `search_tools`, `enable_tools`,
                  `list_servers`, `slim_stats`.
  stats.ts        Token estimation + reporting (used by `stats` command and meta-tool).
```

### How it works per turn
1. Client calls `tools/list` -> proxy asks all upstreams, ranks tools against
   recent conversation signals, exposes top-K (default 24) + meta-tools.
2. When the client calls a tool that belongs to an upstream server, the proxy
   routes the request transparently and forwards the result.
3. `search_tools` lets the agent pull in more tools on demand ("progressive
   disclosure"); `enable_tools` pins them for the session.
4. Schema compression happens at exposure time: descriptions truncated to a
   budget, redundant JSON Schema keywords dropped.

### Modes
- `auto` (default): top-K ranking per turn + meta-tools.
- `manual`: user pins tool/server allowlists in config.
- `off`: pure transparent aggregation proxy (still useful: unify N servers
  behind one entry).

### Config discovery order
1. `CTX_SLIM_CONFIG` env var (explicit path).
2. `./ctxslim.json` in cwd.
3. Auto-discovery of known client configs (Claude Desktop, Cursor, Windsurf,
   VS Code, Codex) — read-only; servers are proxied, config never modified.

## Data flow

Client <-> proxy: stdio (JSON-RPC/MCP). Proxy <-> upstreams: stdio child
processes spawned from their config entries (command/args/env/cwd), or HTTP
for url-based entries. Tool call results pass through byte-for-byte except
for error normalization.

## Token accounting

Estimated by chars/4 heuristic per schema + per result payload. Exposed via
`slim_stats` and `ctxslim stats` (after a session, from a local log in
`~/.ctxslim/stats.json`, opt-out via `--no-stats`).

## Error handling

- Upstream crash: server marked unhealthy, excluded from tools/list, error
  surfaced via meta-tool; auto-restart with backoff (max 3).
- Client disconnects: kill upstream children.
- Bad config: actionable error message listing what was wrong and where.

## Testing

- Unit: ranker (scoring, top-K, recency), compressor (budgets, schema edge
  cases), config loader (discovery, malformed files).
- Integration: spawn proxy against fake stdio MCP servers; assert tools/list
  filtering, routing, meta-tools, stats.

## Out of scope (v1)

- HTTP/SSE client transport for the proxy itself (stdio only).
- Semantic (embedding) ranking — lexical BM25 first, pluggable later.
- GUI/TUI.

## Name / branding

- Repo/package: `ctxslim`
- Tagline: "Your MCP servers are eating your context. Put them on a diet."
- Mascot: slim pickle/jalapeño character ("Slim") — SVG in assets/, shown in
  README header and used as social avatar.
