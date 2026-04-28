import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { CostProvider } from "../../src/providers/index.ts";

const FIXTURE_ROWS = [
  {
    service_name: "Cloud Run",
    usage_date: { value: "2026-04-26" },
    total_cost: 234.56,
    total_credits: -12.34,
  },
  {
    service_name: "BigQuery",
    usage_date: { value: "2026-04-26" },
    total_cost: 89.0,
    total_credits: 0,
  },
  {
    service_name: "Cloud Storage",
    usage_date: { value: "2026-04-26" },
    total_cost: 0,
    total_credits: 0,
  },
];

mock.module("@google-cloud/bigquery", () => ({
  BigQuery: class {
    constructor(public opts: unknown) {}
    dataset() {
      return { getTables: async () => [[{ id: "gcp_billing_export_v1" }]] };
    }
    async query() {
      return [FIXTURE_ROWS];
    }
  },
}));

mock.module("../../src/config.ts", () => ({
  loadConfig: () => ({
    providers: {
      gcp: {
        enabled: true,
        project_id: "test-project",
        billing_dataset: "billing_export.gcp_billing_export_v1",
      },
    },
    alerts: {
      default_threshold: 100,
      escalation: [],
      acknowledge_ttl: "24h",
      slack_webhook_url_env: "",
    },
    polling: { interval: 3600 },
  }),
  resolveEnvVar: () => "fake-value",
  getTansoDir: () => "/tmp/tanso-test",
  getGlobalConfigPath: () => "/tmp/tanso-test/config.yaml",
  getLocalConfigPath: () => "/tmp/tanso-test/.tanso.yaml",
  configExists: () => true,
  getEnabledProviders: () => ["gcp"],
  frequencyToIntervalMs: () => 86400000,
}));

let provider: CostProvider;

beforeAll(async () => {
  const { getProvider } = await import("../../src/providers/index.ts");
  await import("../../src/providers/gcp.ts");
  provider = getProvider("gcp")!;
});

describe("GCP provider", () => {
  test("parses BigQuery billing rows with credits", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.service).toBe("Cloud Run");
    expect(entries[0]!.amount_usd).toBeCloseTo(222.22, 2);
    expect(entries[1]!.service).toBe("BigQuery");
    expect(entries[1]!.amount_usd).toBe(89);
  });

  test("skips zero net cost services", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    const storage = entries.find((e) => e.service === "Cloud Storage");
    expect(storage).toBeUndefined();
  });

  test("preflight checks billing export exists", async () => {
    const status = await provider.preflight();
    expect(status.healthy).toBe(true);
  });
});
