# Contributing to Context Slim

Thanks for your interest in making Context Slim better. This document covers both the **how** and the **why** — because knowing why a rule exists is the difference between following it and resenting it.

## Why this project exists

MCP clients pay a context tax for every connected server: full tool schemas in every prompt. Context Slim taxes that tax down to something reasonable. Every contribution should serve that single job — if a change doesn't reduce context, reduce friction, or increase trust in one of those, it probably belongs in a different project.

## The philosophy (read before your first PR)

**No comments in the code.** If the code needs a comment, the code needs a better name or a smaller function. This is a hard rule in this repo, applied to all new code. Doc-level prose belongs in `README.md` or `docs/design.md`.

**Small dependency surface.** Runtime dependencies are the MCP SDK and nothing else (we may even drop zod). Every dependency is a supply-chain risk and an install-time tax. If the standard library can do it in 20 lines, 20 lines wins.

**Strict TypeScript.** `noUncheckedIndexedAccess`, `noUnusedLocals`, the whole strict family. The build has zero warnings; keep it that way.

**Tests are the spec.** Every behavior change ships with a test that would fail without it. The integration suite speaks real MCP over real transports — extend it rather than mocking it away.

**Errors are actionable.** A config error must say what was wrong, where, and how to fix it. "Invalid config" is a bug report against ourselves.

## Getting started

```bash
git clone https://github.com/v01dst/context-slim.git
cd context-slim
npm install
npm test          # all 43 tests must pass
npm run typecheck # strict type check
npm run build     # emits dist/
npm run bench     # measure savings, writes bench-results.json
```

You'll need Node 18+. No other services, no API keys, nothing to sign up for — the whole thing runs on your machine.

## Project map

| Path | What lives there | Why you'd touch it |
| --- | --- | --- |
| `src/server.ts` | The proxy: MCP handlers, routing, exposure logic | New modes, new meta tools, routing behavior |
| `src/compressor.ts` | Schema compression + token estimation | Better compression rules |
| `src/ranker.ts` | BM25-ish indexing and usage scoring | Smarter tool selection |
| `src/config.ts` | Config discovery, validation, stats persistence | New client config formats, new CLI options |
| `src/upstream.ts` | Connections to upstream MCP servers | Transports, reconnect logic |
| `src/meta.ts` | The meta tools exposed to agents | New agent-facing helpers |
| `src/index.ts` | CLI entry | Flags, subcommands |
| `tests/` | Unit + integration suites, fake MCP server | Any behavior change |
| `docs/design.md` | The design document | Architecture decisions |

## Making changes

1. **Open or find an issue first.** Small typo-class fixes don't need one, anything behavioral does. It keeps discussions attached to history instead of PR threads.
2. **Branch from `main`.** Name it something descriptive: `fix/reconnect-backoff`, `feat/toml-config`.
3. **Follow [Conventional Commits](https://www.conventionalcommits.org)**: `feat:`, `fix:`, `docs:`, `test:`, `perf:`, `refactor:`. Release notes are generated from these.
4. **Add tests for behavior changes.** If you fix a bug, the test must fail on the old code.
5. **Run the full suite locally** — green `npm test` and `npm run typecheck` are required for merge. CI runs the same on Node 20 and 22.
6. **Keep PRs focused.** One idea per PR. A 200-line PR gets reviewed carefully in minutes; a 2,000-line one gets skimmed and stalls.

## What makes a PR get merged fast

- It matches the philosophy above (no comments, no new deps, strict TS).
- It includes a benchmark run if it affects compression or ranking — show the before/after table in the PR description.
- The error messages it adds would pass the "confused user at 2am" test.

## Good first contributions

Not sure where to start? These are always open and genuinely useful:

- **New client config support** — Codex reads TOML, Gemini CLI reads JSON, others exist. Each is a small, isolated `config.ts` addition plus a test.
- **Compression rules** — real-world schemas have more junk than we strip. Found some? Add the rule and the test.
- **Doctor improvements** — `context-slim doctor` should eventually try connecting to each server and report per-server health. It's the friendliest surface in the codebase.
- **Docs** — if a paragraph in the README confused you, fixing it helps the next person. Docs PRs are merged with priority.

## Reporting bugs

Open an issue with:

1. What you ran (exact command / config snippet — redact secrets).
2. What happened vs. what you expected.
3. Output of `context-slim doctor` if it's a connection issue.
4. Your `context-slim --version` and Node version.

## Reporting security issues

Do not open a public issue. Context Slim runs locally and talks to your configured servers, but if you've found something — a prototype pollution path in config parsing, a way to leak tool schemas off-machine — email or DM the maintainer directly. We'll credit you in the release notes.

## Recognition

Every contributor goes in the repo's contributor graph automatically, and meaningful contributions get a callout in release notes. If you're contributing regularly and want more ownership (triage, review), say so — maintainers here are grown, not born.

---

<small>Thanks for reading this far. That already puts you ahead of 90% of drive-by PRs.</small>
