#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import {
  loadConfig,
  configExists,
  getEnabledProviders,
  getTansoDir,
} from "./config.ts";
import {
  getDb,
  getDailySpend,
  getMtdSpend,
  getLatestFetchTime,
  upsertCostSnapshot,
  closeDb,
} from "./db.ts";
import { getAllProviders, getRegisteredNames } from "./providers/index.ts";
import { evaluateAlerts } from "./alerts/engine.ts";
import { sendSlackAlert } from "./alerts/slack.ts";
import {
  acknowledgeAlert,
  raiseThreshold,
  listAlertRules,
  getAlertRule,
} from "./alerts/acknowledge.ts";
import {
  getCronStatus,
  writeCronEntry,
  removeCronEntry,
} from "./cron-setup.ts";

import "./providers/aws.ts";
import "./providers/gcp.ts";
import "./providers/azure.ts";
import "./providers/openai.ts";
import "./providers/anthropic.ts";

const program = new Command();

program
  .name("tanso")
  .description("CLI cost observability for cloud and AI spend")
  .version("0.1.0");

program
  .command("init")
  .description(
    "Interactive setup: detect creds, pick providers, set Slack webhook, write crontab",
  )
  .action(async () => {
    const { runInit } = await import("./init.ts");
    await runInit();
  });

program
  .command("status")
  .description("One-screen spend summary: per-provider, per-service, daily/MTD")
  .action(() => {
    if (!configExists()) {
      console.error(chalk.red("No config found. Run `tanso init` first."));
      process.exit(1);
    }

    const today = new Date().toISOString().split("T")[0]!;
    const daily = getDailySpend(today);
    const mtd = getMtdSpend();
    const lastFetch = getLatestFetchTime();

    console.log(chalk.bold("\n  tanso-watch status\n"));

    if (lastFetch) {
      console.log(chalk.dim(`  Last fetch: ${lastFetch}\n`));
    } else {
      console.log(
        chalk.yellow(
          "  No data yet. Run `tanso watch --once` to fetch costs.\n",
        ),
      );
      return;
    }

    if (daily.length > 0) {
      console.log(chalk.bold("  Today's spend:"));
      const byProvider = groupByProvider(daily);
      printSpendTable(byProvider);
    }

    if (mtd.length > 0) {
      console.log(chalk.bold("\n  Month-to-date:"));
      const byProvider = groupByProvider(mtd);
      printSpendTable(byProvider);
    }

    console.log();
    closeDb();
  });

program
  .command("watch")
  .description("Run a single cost check (--once) or show cron status")
  .option("--once", "Single check, fetch costs, evaluate alerts, then exit")
  .action(async (opts) => {
    if (!configExists()) {
      console.error(chalk.red("No config found. Run `tanso init` first."));
      process.exit(1);
    }

    if (opts.once) {
      await runOnce();
    } else {
      showCronStatus();
    }
  });

const alertsCmd = program
  .command("alerts")
  .description("Manage alert thresholds and escalation");

alertsCmd
  .command("config")
  .description("Set/edit thresholds and escalation rules")
  .action(() => {
    const config = loadConfig();
    console.log(chalk.bold("\n  Alert configuration:\n"));
    console.log(
      chalk.dim("  Default threshold:"),
      `$${config.alerts.default_threshold}/day`,
    );
    console.log(chalk.dim("  Acknowledge TTL:"), config.alerts.acknowledge_ttl);
    console.log(chalk.dim("  Escalation levels:"));
    for (const level of config.alerts.escalation) {
      console.log(`    Above $${level.above}/day → ${level.frequency}`);
    }
    console.log(
      chalk.dim(`\n  Edit ${getTansoDir()}/config.yaml to change.\n`),
    );
  });

alertsCmd
  .command("list")
  .description("Show active alerts and their escalation state")
  .action(() => {
    const rules = listAlertRules();
    if (rules.length === 0) {
      console.log(chalk.dim("\n  No alert rules configured.\n"));
      return;
    }
    console.log(chalk.bold("\n  Alert rules:\n"));
    for (const rule of rules) {
      const scope = [
        rule.provider ?? "all providers",
        rule.service ?? "all services",
      ].join(" / ");
      const status = rule.acknowledged_until
        ? chalk.yellow(`acked until ${rule.acknowledged_until}`)
        : rule.enabled
          ? chalk.green("active")
          : chalk.dim("disabled");
      console.log(
        `  ${chalk.dim(rule.id.slice(0, 8))}  $${rule.threshold_usd_per_day}/day  ${scope}  ${status}`,
      );
    }
    console.log();
    closeDb();
  });

alertsCmd
  .command("raise <alert-id> <new-threshold>")
  .description("Permanently adjust threshold for an alert rule")
  .action((alertId: string, newThreshold: string) => {
    const threshold = parseFloat(newThreshold);
    if (isNaN(threshold) || threshold <= 0) {
      console.error(chalk.red("Threshold must be a positive number."));
      process.exit(1);
    }
    const rule = getAlertRule(alertId);
    if (!rule) {
      console.error(chalk.red(`No alert rule found matching "${alertId}".`));
      process.exit(1);
    }
    raiseThreshold(rule.id, threshold);
    console.log(
      chalk.green(
        `Threshold for ${rule.id.slice(0, 8)} raised to $${threshold}/day.`,
      ),
    );
    closeDb();
  });

program
  .command("ack <alert-id>")
  .description("Acknowledge a cost drift alert (suppresses for TTL)")
  .action((alertId: string) => {
    const config = loadConfig();
    const rule = getAlertRule(alertId);
    if (!rule) {
      console.error(chalk.red(`No alert rule found matching "${alertId}".`));
      process.exit(1);
    }
    acknowledgeAlert(rule.id, config.alerts.acknowledge_ttl);
    console.log(
      chalk.green(
        `Alert ${rule.id.slice(0, 8)} acknowledged. Suppressed for ${config.alerts.acknowledge_ttl}.`,
      ),
    );
    closeDb();
  });

const providersCmd = program
  .command("providers")
  .description("Manage cost providers");

providersCmd
  .command("list")
  .description("Show configured providers and connection status")
  .action(async () => {
    if (!configExists()) {
      console.error(chalk.red("No config found. Run `tanso init` first."));
      process.exit(1);
    }
    const config = loadConfig();
    const enabled = getEnabledProviders(config);
    console.log(chalk.bold("\n  Configured providers:\n"));

    const providers = getAllProviders();
    for (const p of providers) {
      const isEnabled = enabled.includes(p.name);
      if (!isEnabled) {
        console.log(`  ${chalk.dim("○")} ${p.name} ${chalk.dim("(disabled)")}`);
        continue;
      }
      const status = await p.preflight();
      const icon = status.healthy ? chalk.green("●") : chalk.red("●");
      const detail = status.healthy
        ? chalk.green("healthy")
        : chalk.red(status.error ?? "unhealthy");
      console.log(`  ${icon} ${p.name} ${detail}`);
    }
    console.log();
  });

providersCmd
  .command("add")
  .description("Add a new provider interactively")
  .action(async () => {
    const { addProvider } = await import("./init.ts");
    await addProvider();
  });

program
  .command("link")
  .description("Links to Observe dashboard and Tanso platform")
  .action(() => {
    console.log(
      chalk.bold(
        "\n  Want per-customer margins, revenue aggregation, and team dashboards?\n",
      ),
    );
    console.log(
      `  Observe:        ${chalk.cyan("https://observe.tansohq.com")} ${chalk.dim("(open source, self-host)")}`,
    );
    console.log(
      `  Tanso Platform: ${chalk.cyan("https://dashboard.tansohq.com")} ${chalk.dim("(managed, enterprise)")}`,
    );
    console.log();
  });

async function runOnce(): Promise<void> {
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  const providers = getAllProviders().filter((p) => enabled.includes(p.name));

  if (providers.length === 0) {
    console.error(
      chalk.red("No providers enabled. Run `tanso init` to configure."),
    );
    process.exit(1);
  }

  console.log(
    chalk.dim(`\n  Preflight: checking ${providers.length} provider(s)...`),
  );

  const healthy: typeof providers = [];
  const degraded: string[] = [];

  for (const p of providers) {
    const status = await p.preflight();
    if (status.healthy) {
      healthy.push(p);
      console.log(chalk.green(`  ✓ ${p.name}`));
    } else {
      degraded.push(`${p.name}: ${status.error}`);
      console.log(chalk.red(`  ✗ ${p.name}: ${status.error}`));
    }
  }

  if (degraded.length > 0) {
    console.log(
      chalk.yellow(
        `\n  ${degraded.length} provider(s) degraded. Continuing with ${healthy.length}.\n`,
      ),
    );
  }

  if (healthy.length === 0) {
    console.error(
      chalk.red("  All providers failed preflight. Nothing to fetch."),
    );
    process.exit(1);
  }

  const today = new Date().toISOString().split("T")[0]!;
  const yesterday = new Date(Date.now() - 86400000)
    .toISOString()
    .split("T")[0]!;

  let totalEntries = 0;
  for (const p of healthy) {
    try {
      const entries = await p.fetchCosts(yesterday, today);
      for (const entry of entries) {
        upsertCostSnapshot(
          entry.provider,
          entry.service,
          entry.date,
          entry.amount_usd,
          entry.raw_response,
        );
        totalEntries++;
      }
    } catch (err) {
      console.error(
        chalk.red(
          `  Error fetching ${p.name}: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
  }

  console.log(chalk.dim(`\n  Stored ${totalEntries} cost entries.`));

  const dailySpend = getDailySpend(today);
  const alerts = evaluateAlerts(config, dailySpend);

  if (alerts.length > 0) {
    const webhookEnv = config.alerts.slack_webhook_url_env;
    const webhookUrl = process.env[webhookEnv];
    for (const alert of alerts) {
      if (webhookUrl) {
        await sendSlackAlert(webhookUrl, alert);
      }
      console.log(
        chalk.yellow(
          `  Alert: ${alert.provider ?? "all"} $${alert.amount.toFixed(2)}/day > $${alert.threshold}/day (level ${alert.escalation_level})`,
        ),
      );
    }
  } else {
    console.log(chalk.green("  No alerts triggered."));
  }

  console.log();
  closeDb();
}

function showCronStatus(): void {
  const status = getCronStatus();
  console.log(chalk.bold("\n  tanso-watch cron status\n"));
  if (status.installed) {
    console.log(chalk.green("  Cron entry installed:"));
    console.log(chalk.dim(`  ${status.entry}`));
  } else {
    console.log(
      chalk.yellow("  No cron entry found. Run `tanso init` to set up."),
    );
  }

  const lastFetch = getLatestFetchTime();
  if (lastFetch) {
    console.log(chalk.dim(`\n  Last data fetch: ${lastFetch}`));
  }
  console.log();
  closeDb();
}

function groupByProvider(
  entries: Array<{ provider: string; service: string; amount_usd: number }>,
): Map<string, Array<{ service: string; amount: number }>> {
  const map = new Map<string, Array<{ service: string; amount: number }>>();
  for (const e of entries) {
    const list = map.get(e.provider) ?? [];
    list.push({ service: e.service, amount: e.amount_usd });
    map.set(e.provider, list);
  }
  return map;
}

function printSpendTable(
  byProvider: Map<string, Array<{ service: string; amount: number }>>,
): void {
  for (const [provider, services] of byProvider) {
    const total = services.reduce((s, e) => s + e.amount, 0);
    console.log(
      `    ${chalk.bold(provider)} ${chalk.cyan("$" + total.toFixed(2))}`,
    );
    for (const svc of services.slice(0, 5)) {
      console.log(chalk.dim(`      ${svc.service}: $${svc.amount.toFixed(2)}`));
    }
    if (services.length > 5) {
      console.log(chalk.dim(`      ... and ${services.length - 5} more`));
    }
  }
}

program.parse();
