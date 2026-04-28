import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

export interface ProviderConfig {
  enabled: boolean;
  region?: string;
  project_id?: string;
  billing_dataset?: string;
  subscription_id?: string;
  admin_key_env?: string;
}

export interface EscalationLevel {
  above: number;
  frequency: "daily" | "3x_daily" | "5x_daily" | "hourly";
}

export interface AlertsConfig {
  slack_webhook_url_env: string;
  default_threshold: number;
  escalation: EscalationLevel[];
  acknowledge_ttl: string;
}

export interface QuietHours {
  start: string;
  end: string;
  timezone: string;
}

export interface PollingConfig {
  interval: number;
  quiet_hours?: QuietHours;
}

export interface TansoConfig {
  providers: Record<string, ProviderConfig>;
  alerts: AlertsConfig;
  polling: PollingConfig;
}

const DEFAULT_CONFIG: TansoConfig = {
  providers: {},
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
  polling: {
    interval: 3600,
  },
};

export function getTansoDir(): string {
  return join(homedir(), ".tanso");
}

export function getGlobalConfigPath(): string {
  return join(getTansoDir(), "config.yaml");
}

export function getLocalConfigPath(): string {
  return join(process.cwd(), ".tanso.yaml");
}

function loadYamlFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  return yaml.load(raw) as Record<string, unknown> | null;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];
    if (
      baseVal &&
      overVal &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal) &&
      typeof overVal === "object" &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

export function loadConfig(): TansoConfig {
  const globalRaw = loadYamlFile(getGlobalConfigPath());
  const localRaw = loadYamlFile(getLocalConfigPath());

  let merged: Record<string, unknown> = DEFAULT_CONFIG as unknown as Record<
    string,
    unknown
  >;

  if (globalRaw) {
    merged = deepMerge(merged, globalRaw);
  }
  if (localRaw) {
    merged = deepMerge(merged, localRaw);
  }

  return merged as unknown as TansoConfig;
}

export function configExists(): boolean {
  return existsSync(getGlobalConfigPath());
}

export function resolveEnvVar(envName: string): string | undefined {
  return process.env[envName];
}

export function getEnabledProviders(config: TansoConfig): string[] {
  return Object.entries(config.providers)
    .filter(([, cfg]) => cfg.enabled)
    .map(([name]) => name);
}

export function frequencyToIntervalMs(
  frequency: EscalationLevel["frequency"],
): number {
  switch (frequency) {
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "3x_daily":
      return 8 * 60 * 60 * 1000;
    case "5x_daily":
      return (24 / 5) * 60 * 60 * 1000;
    case "hourly":
      return 60 * 60 * 1000;
  }
}
