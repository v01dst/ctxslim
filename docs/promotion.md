# CtxSlim — Promotion Plan

Repo: https://github.com/v01dst/ctxslim

## The hook (use this everywhere)

> Your MCP servers burn 30k+ tokens before you even ask a question.
> CtxSlim cuts it by up to 72%. One config line. Zero API keys.

## Accounts + assets

- Avatar: use `assets/mascot.svg` (export to 400x400 PNG)
- X/Reddit post image: export `assets/banner.svg` to 1280x640 PNG
- Before/after screenshot: run `ctxslim` with a TTY and capture stderr (the banner prints real token savings)

## Launch sequence (do it in this order, don't skip ahead)

### Day 0 — GitHub housekeeping
1. npm publish (`npm publish` — makes the npx one-liner real; skip README claims until live)
2. Pin the repo on your profile
3. Add a live demo GIF to README (asciinema → GIF of `ctxslim` banner + a client listing tools)

### Day 1 — X / Twitter thread (post at 9-11am EST, Tue-Thu)
Pin the thread. Post 1 hooks, post 2 shows the fix, post 3 shows numbers + link.

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
1. GitHub discussions: r/mcp's awesome lists, `punkpeye/awesome-mcp-devtools` — open a PR adding CtxSlim under devtools. This is the highest-converting link for MCP tooling.
2. Discord servers: MCP community, Cursor, Claude developer Discords — #showcase channels.
3. Answer existing questions about "MCP context bloat" / "too many MCP tools" on Reddit/Stack Overflow; mention the repo naturally in a genuinely helpful answer.

## Voice rules
- Always lead with the pain (token bloat), never the tech
- Always use real measured numbers — they're the credibility
- Never spam multiple communities the same day; one channel per day
- Reply to every comment in the first 2 hours; that's when algorithms decide reach

## Metrics to watch (first 2 weeks)
- npm installs (leading indicator, days before stars)
- GitHub stars
- traffic sources: Insights → Traffic (which post actually converts)
- If a channel doesn't convert in week 1, don't repost there — double down on the one that did
