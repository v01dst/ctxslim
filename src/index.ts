#!/usr/bin/env node
import { readFileSync } from "node:fs";
import type { ContextSlimConfig } from "./types.js";
import { loadAuditRecords, loadConfig, loadStatsSummary, loadUsageMap, describeConfig } from "./config.js";
import { summarizeAudit } from "./audit.js";
import { tokensForChars } from "./compressor.js";
import { PRICE_AS_OF, PRICE_TABLE, dollarsFor, familyNames, parsePricesFile } from "./pricing.js";
import { ContextSlimServer } from "./server.js";
import { BANNER, bold, cyan, dim, fmtTokens, green, red, yellow } from "./ui.js";
import { applyInit, existingTargets, planInit, resolveTarget } from "./init.js";

const usage = (): string =>
  [
    "",
    `  ${bold("ctxslim")} ${dim("— put your MCP servers on a diet")}`,
    "",
    `  ${cyan("Usage")}`,
    `    ctxslim                     Start the proxy (uses auto-discovered config)`,
    `    ctxslim init [--client <name|path>] [--yes]`,
    `                                Wire the proxy into a detected client config`,
    `                                (default: preview only; --yes writes a backup first)`,
    `    ctxslim --config <path>     Use a specific config file`,
    `    ctxslim --mode <mode>       auto | manual | off (default: auto)`,
    `    ctxslim --max-tools <n>     Max tools exposed per turn (default: 24)`,
    `    ctxslim --quiet             No banner, minimal logging`,
    `    ctxslim --no-stats          Don't write session stats to ~/.ctxslim`,
    `    ctxslim stats [--json]          Show saved token savings (JSON with --json)`,
    `    ctxslim audit [--gap <s>] [--model <fam>] [--prices <file>] [--json]`,
    `                                Show per-task dollar spend (prices are estimates)`,
    `    ctxslim doctor [--tune]     Check config and connectivity (tune suggests improvements)`,
    `    ctxslim --help              This message`,
    "",
  ].join("\n");

type Args = {
  config?: string;
  mode?: string;
  maxTools?: number;
  quiet?: boolean;
  noStats?: boolean;
  command?: string;
  client?: string;
  yes?: boolean;
  json?: boolean;
  gap?: number;
  model?: string;
  prices?: string;
  tune?: boolean;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config" || arg === "-c") {
      const value = argv[++i];
      if (!value) fail("--config requires a path");
      args.config = value;
    } else if (arg === "--client") {
      const value = argv[++i];
      if (!value) fail("--client requires a name (cursor, claude-desktop, windsurf, vscode, claude-code) or a config path");
      args.client = value;
    } else if (arg === "--yes" || arg === "-y") {
      args.yes = true;
    } else if (arg === "--mode") {
      const value = argv[++i];
      if (!value || !["auto", "manual", "off"].includes(value)) fail("--mode must be auto, manual or off");
      args.mode = value;
    } else if (arg === "--max-tools") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 1) fail("--max-tools must be a positive number");
      args.maxTools = value;
    } else if (arg === "--quiet" || arg === "-q") {
      args.quiet = true;
    } else if (arg === "--no-stats") {
      args.noStats = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage() + "\n");
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      process.stdout.write("0.4.1\n");
      process.exit(0);
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--gap") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) fail("--gap must be a positive number of seconds");
      args.gap = value;
    } else if (arg === "--model") {
      const value = argv[++i];
      if (!value) fail("--model requires a family name");
      args.model = value;
    } else if (arg === "--prices") {
      const value = argv[++i];
      if (!value) fail("--prices requires a path");
      args.prices = value;
    } else if (arg === "--tune") {
      args.tune = true;
    } else if (arg === "stats" || arg === "doctor" || arg === "init" || arg === "audit") {
      args.command = arg;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const fail = (message: string): never => {
  process.stderr.write(`${red("error:")} ${message}\n\n${usage()}\n`);
  process.exit(1);
};

const runInit = (args: Args): void => {
  const detected = existingTargets();
  if (args.client) {
    const resolved = resolveTarget(args.client) ?? fail(`Could not resolve client "${args.client}". Use a name (cursor, claude-desktop, windsurf, vscode, claude-code) or a config path.`);
    const plan = planInit(resolved);
    if (plan.error) fail(`${resolved.path} could not be parsed: ${plan.error}`);
    if (plan.alreadyInstalled) {
      process.stdout.write(`\n  ${yellow("!")} ctxslim is already installed in ${resolved.path} — nothing to do.\n\n`);
      return;
    }
    if (!args.yes) {
      process.stdout.write(
        [
          "",
          `  ${bold("Preview")} ${dim(`(re-run with --yes to write)`)}`,
          "",
          `  target    ${resolved.path}`,
          `  servers   ${plan.serverCount}`,
          `  change    add "ctxslim" entry to mcpServers (npx -y ctxslim)`,
          `  backup    written before any modification`,
          "",
        ].join("\n")
      );
      return;
    }
    const result = applyInit(resolved);
    process.stdout.write(`\n  ${result.ok ? green("✓") : red("✗")} ${result.message}\n\n`);
    if (!result.ok) process.exit(1);
    return;
  }
  if (detected.length === 0) {
    process.stdout.write(
      [
        "",
        `  ${yellow("!")} No known client configs found on this machine.`,
        "",
        `  Run ${cyan("ctxslim init --client /path/to/config.json")} to target a file directly,`,
        `  or create a ctxslim.json in your project and run ${cyan("ctxslim")}.`,
        "",
      ].join("\n")
    );
    return;
  }
  process.stdout.write(
    [
      "",
      `  ${bold("Detected client configs")}`,
      "",
      ...detected.map((target) => {
        const plan = planInit(target);
        const status = plan.alreadyInstalled ? green("installed") : plan.error ? red("unreadable") : yellow("not wired");
        return `  ${status.padEnd(12)} ${target.label.padEnd(16)} ${dim(target.path)} ${dim(`(${plan.serverCount} servers)`)}`;
      }),
      "",
      `  Wire one up:  ${cyan("ctxslim init --client cursor --yes")}`,
      `  (a timestamped backup of the config is written first)`,
      "",
    ].join("\n")
  );
};

const printStats = (json: boolean): void => {
  const { summary } = loadStatsSummary();
  const usage = loadUsageMap();
  const byTool = Object.entries(usage)
    .map(([key, record]) => ({ key, count: record.count, lastUsed: record.lastUsed }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  if (json) {
    process.stdout.write(`${JSON.stringify({ summary, byTool }, null, 2)}\n`);
    return;
  }
  if (summary.sessions === 0 && byTool.length === 0) {
    process.stdout.write(
      `  ${dim("No sessions recorded yet.")}\n  ${dim("Run ctxslim with your MCP client and stats will appear here.")}\n`
    );
    return;
  }
  const lines = [
    "",
    `  ${bold("CtxSlim")} ${dim("— usage stats")}`,
    "",
    `  sessions recorded   ${summary.sessions}`,
    `  tool calls routed   ${summary.totalCalls}`,
    `  avg context size    ${fmtTokens(Math.round(summary.avgTokensBefore))} → ${fmtTokens(Math.round(summary.avgTokensAfter))} tokens`,
    `  avg savings         ${green(`-${summary.avgSavingsPct.toFixed(1)}%`)}`,
  ];
  if (byTool.length > 0) {
    lines.push("", `  ${bold("Top tools (all sessions)")}`);
    for (const item of byTool.slice(0, 10)) {
      lines.push(`    ${String(item.count).padStart(5)}×  ${item.key}`);
    }
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
};

const fmtUsd = (value: number): string => (value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`);

const printAudit = (opts: { gap: number; model?: string; prices?: string; json: boolean }): void => {
  const { records, corrupt } = loadAuditRecords();
  let table = PRICE_TABLE;
  let asOf = PRICE_AS_OF;
  if (opts.prices) {
    try {
      const raw: unknown = JSON.parse(readFileSync(opts.prices, "utf8"));
      table = parsePricesFile(raw);
      asOf = "custom file";
    } catch (err) {
      process.stderr.write(`${red("prices:")} ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  }
  if (opts.model && !table.some((row) => row.family === opts.model)) {
    process.stderr.write(`${red("model:")} unknown family "${opts.model}" (known: ${familyNames(table).join(", ")})\n`);
    process.exit(1);
  }
  const headFamily = opts.model ?? "claude-sonnet-5";
  if (!table.some((row) => row.family === headFamily)) {
    process.stderr.write(`${red("model:")} default family "claude-sonnet-5" not in price table; pass --model explicitly\n`);
    process.exit(1);
  }
  if (records.length === 0) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ summary: null, tasks: [], tools: [], waste: { duplicates: [], errors: [] } }, null, 2)}\n`);
      return;
    }
    process.stdout.write(`  ${dim("No audit data yet.")}\n  ${dim("Run ctxslim with your MCP client, then re-run ctxslim audit.")}\n`);
    return;
  }
  const summary = summarizeAudit(records, opts.gap);
  let defsTokens = 0;
  try {
    const { lines } = loadStatsSummary();
    defsTokens = lines.length > 0 ? Math.round(lines.reduce((sum, line) => sum + line.tokensAfter, 0) / lines.length) : 0;
  } catch {
    defsTokens = 0;
  }
  const spendByFamily: Record<string, number> = {};
  for (const row of table) spendByFamily[row.family] = dollarsFor(tokensForChars(summary.totalOutChars), row.inputPer1M);
  const defsByFamily: Record<string, { full: number; cached: number }> = {};
  for (const row of table) {
    defsByFamily[row.family] = {
      full: dollarsFor(defsTokens, row.inputPer1M),
      cached: dollarsFor(defsTokens, row.cacheReadPer1M ?? row.inputPer1M),
    };
  }
  const wasteSpend = (chars: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of table) out[row.family] = dollarsFor(tokensForChars(chars), row.inputPer1M);
    return out;
  };
  const byError = new Map<string, { count: number; outChars: number }>();
  for (const record of records) {
    if (!record.isError) continue;
    const key = `${record.server}::${record.tool}`;
    const entry = byError.get(key) ?? { count: 0, outChars: 0 };
    entry.count += 1;
    entry.outChars += record.outChars;
    byError.set(key, entry);
  }
  const errorGroups = [...byError.entries()]
    .map(([key, entry]) => ({ key, count: entry.count, outChars: entry.outChars }))
    .sort((a, b) => b.outChars - a.outChars);
  if (opts.json) {
    const tasks = summary.tasks.map((task) => ({
      id: task.id,
      session: task.session,
      calls: task.calls,
      outTokens: tokensForChars(task.outChars),
      errors: task.errors,
      spend: Object.fromEntries(table.map((row) => [row.family, dollarsFor(tokensForChars(task.outChars), row.inputPer1M)])),
    }));
    const tools = summary.tools.map((row) => ({
      key: row.key,
      calls: row.calls,
      outTokens: tokensForChars(row.outChars),
      errors: row.errors,
      dupCalls: row.dupCalls,
      spend: Object.fromEntries(table.map((family) => [family.family, dollarsFor(tokensForChars(row.outChars), family.inputPer1M)])),
    }));
    const duplicates: { key: string; count: number; wasteTokens: number; spend: Record<string, number> }[] = [];
    const errors: { key: string; count: number; wasteTokens: number; spend: Record<string, number> }[] = [];
    for (const task of summary.tasks) {
      for (const dup of task.dups) duplicates.push({ key: dup.key, count: dup.count, wasteTokens: tokensForChars(dup.wasteChars), spend: wasteSpend(dup.wasteChars) });
    }
    for (const [key, entry] of byError) errors.push({ key, count: entry.count, wasteTokens: tokensForChars(entry.outChars), spend: wasteSpend(entry.outChars) });
    process.stdout.write(
      `${JSON.stringify(
        {
          summary: {
            tasks: summary.tasks.length,
            calls: summary.totalCalls,
            toolOutTokens: tokensForChars(summary.totalOutChars),
            spendByFamily,
            defsPerRequestTokens: defsTokens,
            defsPerRequestByFamily: defsByFamily,
            dupWasteByFamily: wasteSpend(summary.dupWasteChars),
            errorWasteByFamily: wasteSpend(summary.errorWasteChars),
            corrupt,
            pricesAsOf: asOf,
            pricesEstimated: true,
          },
          tasks,
          tools,
          waste: { duplicates, errors },
        },
        null,
        2
      )}\n`
    );
    return;
  }
  const out: string[] = [
    "",
    `  ${bold("CtxSlim")} ${dim("— spend audit")}  ${dim(`(prices indicative as of ${asOf})`)}`,
    "",
    `  tasks               ${summary.tasks.length}`,
    `  tool calls          ${summary.totalCalls}`,
    `  tool-output spend   ${table.map((row) => `${row.family} ${fmtUsd(spendByFamily[row.family] ?? 0)}`).join("  ")}`,
    `  definitions/request ~${fmtTokens(defsTokens)} tokens  ${table.map((row) => `${row.family} ${fmtUsd(defsByFamily[row.family]?.full ?? 0)}/${fmtUsd(defsByFamily[row.family]?.cached ?? 0)}`).join("  ")} ${dim("(full/cached)")}`,
    `  duplicate waste     ${fmtUsd(wasteSpend(summary.dupWasteChars)[headFamily] ?? 0)} ${dim(`(${headFamily})`)}`,
    `  error waste         ${fmtUsd(wasteSpend(summary.errorWasteChars)[headFamily] ?? 0)} ${dim(`(${headFamily})`)}`,
    ...(corrupt > 0 ? [`  ${dim(`(${corrupt} corrupt audit lines skipped)`)}`] : []),
    "",
    `  ${bold(`Top tasks (${headFamily})`)}`,
  ];
  for (const task of summary.tasks.slice(0, 10)) {
    const dominant = Object.entries(task.byServer).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
    const seconds = Math.max(0, Math.round((task.endTs - task.startTs) / 1000));
    out.push(`    ${task.id.padEnd(8)} ${String(task.calls).padStart(4)} calls  ${fmtUsd(dollarsFor(tokensForChars(task.outChars), table.find((row) => row.family === headFamily)?.inputPer1M ?? 0))}  ${dim(dominant)}  ${dim(`${seconds}s`)}`);
  }
  out.push("", `  ${bold(`Top tools (${headFamily})`)}`);
  for (const row of summary.tools.slice(0, 10)) {
    const rate = table.find((entry) => entry.family === headFamily)?.inputPer1M ?? 0;
    out.push(`    ${String(row.calls).padStart(4)}×  ${fmtUsd(dollarsFor(tokensForChars(row.outChars), rate))}  ${row.key}${row.errors > 0 ? `  ${red(`${row.errors} err`)}` : ""}`);
  }
  const dupGroups = summary.tasks.flatMap((task) => task.dups).sort((a, b) => b.wasteChars - a.wasteChars).slice(0, 10);
  if (dupGroups.length > 0) {
    out.push("", `  ${bold("Duplicate calls (paid N× for identical args)")}`);
    for (const dup of dupGroups) {
      const hashHint = dup.key.split("::")[2]?.slice(0, 8) ?? "";
      out.push(`    ${String(dup.count).padStart(4)}×  ${fmtUsd(dollarsFor(tokensForChars(dup.wasteChars), table.find((entry) => entry.family === headFamily)?.inputPer1M ?? 0))} waste  ${dup.server}::${dup.tool}  ${dim(hashHint)}`);
    }
  }
  if (errorGroups.length > 0) {
    out.push("", `  ${bold("Error burns (paid for failed calls)")}`);
    for (const group of errorGroups.slice(0, 10)) {
      out.push(`    ${String(group.count).padStart(4)}×  ${fmtUsd(dollarsFor(tokensForChars(group.outChars), table.find((entry) => entry.family === headFamily)?.inputPer1M ?? 0))} waste  ${group.key}`);
    }
  }
  out.push("", `  ${dim("Model tokens excluded — MCP-attributable spend only. Tune with --gap, --model, --prices.")}`, "");
  process.stdout.write(out.join("\n"));
};

const TUNE_PIN_CALLS = 5;
const TUNE_COVERAGE = 0.9;
const TUNE_BIG_OUTPUT = 8000;
const TUNE_BIG_DEFS = 6000;

type TuneSuggestion = {
  pins: string[];
  maxTools: number | null;
  considerExclude: string[];
  outputCaps: { server: string; maxChars: number }[];
  enableDisclosure: boolean;
  notes: string[];
};

const buildTune = (config: ContextSlimConfig): TuneSuggestion => {
  const usage = loadUsageMap();
  const { lines } = loadStatsSummary();
  const { records } = loadAuditRecords();
  const notes: string[] = [];
  const pins = Object.entries(usage)
    .filter(([, record]) => record.count >= TUNE_PIN_CALLS)
    .map(([key]) => key)
    .sort();
  const callsByTool = new Map<string, number>();
  for (const record of records) {
    const key = `${record.server}::${record.tool}`;
    callsByTool.set(key, (callsByTool.get(key) ?? 0) + 1);
  }
  const current = config.slim?.maxTools && config.slim.maxTools > 0 ? config.slim.maxTools : 24;
  let maxTools: number | null = null;
  const ranked = [...callsByTool.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) {
    notes.push("no call data — maxTools left as is");
  } else {
    let acc = 0;
    let k = 0;
    for (const [, count] of ranked) {
      acc += count;
      k += 1;
      if (acc / total >= TUNE_COVERAGE) break;
    }
    if (k < current) maxTools = k;
    else if (ranked.length > current) maxTools = ranked.length;
  }
  const used = new Set<string>();
  for (const key of Object.keys(usage)) {
    for (const server of Object.keys(config.mcpServers)) {
      if (key === server || key.startsWith(`${server}::`)) used.add(server);
    }
  }
  for (const record of records) used.add(record.server);
  const considerExclude = Object.keys(config.mcpServers).filter((server) => !used.has(server)).sort();
  const outByServer = new Map<string, { total: number; count: number }>();
  for (const record of records) {
    const entry = outByServer.get(record.server) ?? { total: 0, count: 0 };
    entry.total += record.outChars;
    entry.count += 1;
    outByServer.set(record.server, entry);
  }
  const outputCaps = [...outByServer.entries()]
    .filter(([, entry]) => entry.total / entry.count > TUNE_BIG_OUTPUT)
    .map(([server]) => ({ server, maxChars: 4000 }))
    .sort((a, b) => (a.server < b.server ? -1 : 1));
  const meanDefs = lines.length > 0 ? lines.reduce((sum, line) => sum + line.tokensAfter, 0) / lines.length : 0;
  const enableDisclosure = lines.length > 0 && meanDefs > TUNE_BIG_DEFS && config.slim?.disclosure !== true;
  if (records.length === 0 && Object.keys(usage).length === 0 && lines.length === 0) {
    notes.push("no data — run ctxslim with your MCP client first");
  }
  return { pins, maxTools, considerExclude, outputCaps, enableDisclosure, notes };
};

const printTune = (config: ContextSlimConfig, json: boolean): void => {
  const tune = buildTune(config);
  if (json) {
    process.stdout.write(`${JSON.stringify(tune, null, 2)}\n`);
    return;
  }
  const out: string[] = ["", `  ${bold("CtxSlim")} ${dim("— tune suggestions")}  ${dim("(suggest-only; nothing was written)")}`, ""];
  out.push(`  ${bold("Pins")} ${dim(`(usage ≥ ${TUNE_PIN_CALLS} calls)`)}`);
  if (tune.pins.length === 0) out.push(`    ${dim("no data — no pin suggestions")}`);
  for (const pin of tune.pins) out.push(`    ${pin}`);
  out.push("", `  ${bold("maxTools")}`);
  out.push(tune.maxTools === null ? `    ${dim("no data — maxTools left as is")}` : `    suggest maxTools: ${tune.maxTools}`);
  out.push("", `  ${bold("Consider excluding")} ${dim("(zero calls everywhere)")}`);
  if (tune.considerExclude.length === 0) out.push(`    ${dim("no data — every server has calls")}`);
  for (const server of tune.considerExclude) out.push(`    ${server}  ${dim('consider exclude: ["*"]')}`);
  out.push("", `  ${bold("Output caps")} ${dim(`(avg result > ${TUNE_BIG_OUTPUT} chars)`)}`);
  if (tune.outputCaps.length === 0) out.push(`    ${dim("no data — no caps suggested")}`);
  for (const cap of tune.outputCaps) out.push(`    ${cap.server}: output.maxChars ${cap.maxChars}`);
  out.push("", `  ${bold("Disclosure")}`);
  out.push(tune.enableDisclosure ? `    suggest slim.disclosure: true` : `    ${dim("no data — disclosure left as is")}`);
  if (tune.notes.length > 0) {
    out.push("", `  ${bold("Notes")}`);
    for (const note of tune.notes) out.push(`    ${dim(note)}`);
  }
  out.push("");
  process.stdout.write(out.join("\n"));
};

const loadConfigSafe = (configPath?: string): ReturnType<typeof loadConfig> => {
  try {
    return loadConfig(configPath);
  } catch (err) {
    process.stderr.write(`${red("config:")} ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
};

const runDoctor = (args: Args): void => {
  const loaded = loadConfigSafe(args.config);
  if (args.tune) {
    printTune(loaded.config, args.json === true);
    return;
  }
  process.stdout.write(`\n  ${green("✓")} config loaded from ${loaded.source} ${dim(`(${loaded.label})`)}\n`);
  for (const line of describeConfig(loaded.config)) process.stdout.write(`${dim(line)}\n`);
  const slim = loaded.config.slim;
  process.stdout.write(`\n  mode: ${slim?.mode ?? "auto"}  maxTools: ${slim?.maxTools ?? 24}  stats: ${slim?.stats ?? true}\n`);
  process.stdout.write(`\n  ${dim("run")} ctxslim ${dim("to start the proxy and verify server connections.")}\n\n`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "stats") {
    printStats(args.json === true);
    return;
  }
  if (args.command === "audit") {
    printAudit({ gap: args.gap ?? 120, model: args.model, prices: args.prices, json: args.json === true });
    return;
  }
  if (args.command === "init") {
    runInit(args);
    return;
  }
  if (args.command === "doctor") {
    runDoctor(args);
    return;
  }

  const loaded = loadConfigSafe(args.config);
  const slimConfig = { ...(loaded.config.slim ?? {}) };
  if (args.mode) slimConfig.mode = args.mode as typeof slimConfig.mode;
  if (args.maxTools) slimConfig.maxTools = args.maxTools;
  if (args.noStats) slimConfig.stats = false;
  const config = { mcpServers: loaded.config.mcpServers, slim: slimConfig };

  const slim = new ContextSlimServer(config, { stats: !args.noStats, quiet: args.quiet });

  const shutdown = (): void => {
    void slim.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  try {
    if (!args.quiet && process.stderr.isTTY) {
      process.stderr.write(`${cyan(BANNER)}\n`);
    }
    await slim.start();
  } catch (err) {
    process.stderr.write(`${red("error:")} ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  slim.printBanner(`${loaded.source} ${dim(`(${loaded.label})`)}`);
};

main().catch((err) => {
  process.stderr.write(`${red("fatal:")} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
