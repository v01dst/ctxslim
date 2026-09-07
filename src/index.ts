#!/usr/bin/env node
import { loadConfig, loadStatsSummary, describeConfig } from "./config.js";
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
    `    ctxslim stats               Show saved token savings`,
    `    ctxslim doctor              Check config and server connectivity`,
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
      process.stdout.write("0.2.0\n");
      process.exit(0);
    } else if (arg === "stats" || arg === "doctor" || arg === "init") {
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

const printStats = (): void => {
  const { summary } = loadStatsSummary();
  if (summary.sessions === 0) {
    process.stdout.write(
      `  ${dim("No sessions recorded yet.")}\n  ${dim("Run ctxslim with your MCP client and stats will appear here.")}\n`
    );
    return;
  }
  process.stdout.write(
    [
      "",
      `  ${bold("CtxSlim")} ${dim("— session history")}`,
      "",
      `  sessions recorded   ${summary.sessions}`,
      `  tool calls routed   ${summary.totalCalls}`,
      `  avg context size    ${fmtTokens(Math.round(summary.avgTokensBefore))} → ${fmtTokens(Math.round(summary.avgTokensAfter))} tokens`,
      `  avg savings         ${green(`-${summary.avgSavingsPct.toFixed(1)}%`)}`,
      "",
    ].join("\n")
  );
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
  process.stdout.write(`\n  ${green("✓")} config loaded from ${loaded.source} ${dim(`(${loaded.label})`)}\n`);
  for (const line of describeConfig(loaded.config)) process.stdout.write(`${dim(line)}\n`);
  const slim = loaded.config.slim;
  process.stdout.write(`\n  mode: ${slim?.mode ?? "auto"}  maxTools: ${slim?.maxTools ?? 24}  stats: ${slim?.stats ?? true}\n`);
  process.stdout.write(`\n  ${dim("run")} ctxslim ${dim("to start the proxy and verify server connections.")}\n\n`);
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "stats") {
    printStats();
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
