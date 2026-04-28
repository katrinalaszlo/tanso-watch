import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import chalk from "chalk";
import yaml from "js-yaml";
import { getTansoDir, getGlobalConfigPath } from "./config.ts";
import { writeCronEntry } from "./cron-setup.ts";
import { getAllProviders } from "./providers/index.ts";

import "./providers/aws.ts";
import "./providers/gcp.ts";
import "./providers/azure.ts";
import "./providers/openai.ts";
import "./providers/anthropic.ts";

function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

const ADMIN_REQUEST_TEMPLATE = `Hi [admin name],

I'm setting up cost monitoring with tanso-watch (open source CLI tool).
I need read-only billing access for the following:

AWS:       Enable "IAM Access to Billing" in root account settings,
           then attach a policy with ce:GetCostAndUsage to my IAM user/role.

GCP:       Grant roles/billing.viewer + roles/bigquery.dataViewer + roles/bigquery.jobUser
           on the billing export BigQuery dataset.

Azure:     Assign "Cost Management Reader" role on the subscription.

OpenAI:    Generate an admin API key (sk-admin-...) at platform.openai.com/settings/organization/admin-keys

Anthropic: Generate an admin API key (sk-ant-admin-...) at console.anthropic.com/settings/admin-keys

This is read-only access. The tool runs locally on my machine via cron
and never sends cost data to any external service.

More info: https://github.com/katrinalaszlo/tanso-watch`;

export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold("\n  tanso-watch setup\n"));
  console.log(
    chalk.dim(
      "  This will create ~/.tanso/config.yaml and set up a cron job.\n",
    ),
  );

  const dir = getTansoDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const config: Record<string, unknown> = {
    providers: {} as Record<string, unknown>,
    alerts: {
      slack_webhook_url_env: "TANSO_SLACK_WEBHOOK",
      default_threshold: 100,
      escalation: [
        { above: 100, frequency: "daily" },
        { above: 500, frequency: "3x_daily" },
        { above: 1000, frequency: "5x_daily" },
        { above: 5000, frequency: "hourly" },
      ],
      acknowledge_ttl: "24h",
    },
    polling: { interval: 3600 },
  };

  const providers = config.providers as Record<string, unknown>;
  const providerNames = ["aws", "gcp", "azure", "openai", "anthropic"];
  const missingCreds: string[] = [];

  for (const name of providerNames) {
    const yn = await ask(rl, `  Enable ${name}? (y/n) `);
    if (yn.toLowerCase() !== "y") {
      providers[name] = { enabled: false };
      continue;
    }

    switch (name) {
      case "aws":
        providers.aws = { enabled: true, region: "us-east-1" };
        if (
          !process.env.AWS_ACCESS_KEY_ID &&
          !existsSync(`${process.env.HOME}/.aws/credentials`)
        ) {
          missingCreds.push("AWS");
        }
        break;

      case "gcp": {
        const projectId = await ask(rl, "    GCP project ID: ");
        const dataset = await ask(
          rl,
          "    BigQuery billing dataset (e.g. billing_export.gcp_billing_export_v1): ",
        );
        providers.gcp = {
          enabled: true,
          project_id: projectId,
          billing_dataset: dataset,
        };
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          missingCreds.push("GCP");
        }
        break;
      }

      case "azure": {
        const subId = await ask(rl, "    Azure subscription ID: ");
        providers.azure = { enabled: true, subscription_id: subId };
        missingCreds.push("Azure (run `az login` to authenticate)");
        break;
      }

      case "openai":
        providers.openai = { enabled: true, admin_key_env: "OPENAI_ADMIN_KEY" };
        if (!process.env.OPENAI_ADMIN_KEY) {
          missingCreds.push("OpenAI (set OPENAI_ADMIN_KEY env var)");
        }
        break;

      case "anthropic":
        providers.anthropic = {
          enabled: true,
          admin_key_env: "ANTHROPIC_ADMIN_KEY",
        };
        if (!process.env.ANTHROPIC_ADMIN_KEY) {
          missingCreds.push("Anthropic (set ANTHROPIC_ADMIN_KEY env var)");
        }
        break;
    }
  }

  const configYaml = yaml.dump(config, { lineWidth: 120 });
  writeFileSync(getGlobalConfigPath(), configYaml, "utf-8");
  console.log(chalk.green(`\n  Config written to ${getGlobalConfigPath()}`));

  const setupCron = await ask(rl, "\n  Set up hourly cron job? (y/n) ");
  if (setupCron.toLowerCase() === "y") {
    try {
      writeCronEntry(60);
      console.log(
        chalk.green("  Cron entry written. tanso-watch will run hourly."),
      );
    } catch (err) {
      console.error(
        chalk.red(
          `  Failed to write cron entry: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }
  }

  if (missingCreds.length > 0) {
    console.log(chalk.yellow("\n  Missing credentials detected for:"));
    for (const cred of missingCreds) {
      console.log(chalk.yellow(`    - ${cred}`));
    }
    console.log(chalk.bold("\n  Send this to your admin to request access:\n"));
    console.log(chalk.dim(ADMIN_REQUEST_TEMPLATE));
  }

  console.log(
    chalk.bold(
      "\n  Setup complete. Run `tanso watch --once` to fetch your first cost snapshot.\n",
    ),
  );
  rl.close();
}

export async function addProvider(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(chalk.bold("\n  Add a provider\n"));
  console.log(chalk.dim("  Available: aws, gcp, azure, openai, anthropic\n"));
  const name = await ask(rl, "  Provider name: ");
  console.log(chalk.dim(`  Edit ~/.tanso/config.yaml to configure ${name}.\n`));
  rl.close();
}
