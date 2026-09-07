# CtxSlim — Promotion Plan

Repo: https://github.com/v01dst/ctxslim
npm: https://www.npmjs.com/package/ctxslim (v0.2.0, PUBLISHED — one-liner verified working)

## The hook (use this everywhere)

> Your MCP servers burn 30k+ tokens before you even ask a question.
> CtxSlim cuts it by up to 72%. One config line. Zero API keys. 100% local.

## Accounts + assets

- Avatar: `assets/mascot.svg` (export 400x400 PNG)
- X/Reddit post image: `assets/banner.svg` (export 1280x640 PNG)
- Live demo: capture `context-slim` banner with a TTY screenshot tool

## Launch sequence

### Day 0 — housekeeping (npm publish DONE)
- [x] npm publish (0.2.0 live, `npx -y ctxslim` verified)
- [ ] Pin the repo on GitHub profile
- [ ] Add a live demo GIF to README (asciinema → GIF)

### Day 1 — X / Twitter thread (Tue-Thu, 9-11am EST; pin the thread)

**Post 1 (hook):**
```
Your MCP setup is quietly robbing you.

Every server you connect dumps its full tool catalog into your context —
every name, every description, every schema property.

I measured mine: 33,000 tokens gone before asking a single question.

Here's the fix ↓
```

**Post 2 (the fix):**
```
I built CtxSlim: a proxy that sits between your MCP client and your servers.

- exposes only tools relevant to the current task
- your agent pulls more via a search_tools meta-tool when it needs them
- compresses every exposed schema
- 100% local. no API keys, no cloud, no config rewriting.

One entry replaces your whole mcpServers block.
```

**Post 3 (numbers + link):**
```
6 servers × 12 tools, measured through real MCP transports:

BEFORE: 33.4k tokens
AFTER:   9.2k tokens  (−72.6%)

npx -y ctxslim

github.com/v01dst/ctxslim ⭐
[attach banner image]
```

### Day 2 — Reddit (r/mcp, r/ClaudeAI, r/LocalLLaMA — one per day, not all at once)
Title: `I cut my MCP context usage from 33.4k to 9.2k tokens with a local proxy (no API keys)`

Body: lead with the problem story (be honest that you built it), the benchmark table from the README, the config snippet, then the link. Reddit punishes link-only posts; rewards genuine build-in-public writeups. Reply to every comment.

### Day 3 — Hacker News
Title: `Show HN: CtxSlim – Cut MCP context bloat by 72% with a local proxy`
Submit at 8-10am EST weekdays. First comment: the honest technical story (why client-side tool lists are the bottleneck, how BM25 ranking works, what compression does, what's next: embeddings, TOML configs).

### Day 4+ — Community embeds
1. PR to `punkpeye/awesome-mcp-devtools` adding CtxSlim under devtools — highest-converting link for MCP tooling
2. Discord servers: MCP community, Cursor, Claude developer Discords — #showcase channels
3. Answer existing questions about "MCP context bloat" / "too many MCP tools" on Reddit/Stack Overflow; mention the repo naturally in a genuinely helpful answer

## Voice rules
- Always lead with the pain (token bloat), never the tech
- Always use real measured numbers — they're the credibility
- Never spam multiple communities the same day; one channel per day
- Reply to every comment in the first 2 hours; that's when algorithms decide reach

## Metrics to watch (first 2 weeks)
- npm installs (leading indicator, days before stars): npmjs.com/package/ctxslim
- GitHub stars
- traffic sources: Insights → Traffic (which post actually converts)
- If a channel doesn't convert in week 1, don't repost there — double down on the one that did
