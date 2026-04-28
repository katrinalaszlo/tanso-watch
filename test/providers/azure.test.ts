import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { CostProvider } from "../../src/providers/index.ts";

const FIXTURE = {
  properties: {
    columns: [
      { name: "PreTaxCost" },
      { name: "ServiceName" },
      { name: "UsageDate" },
      { name: "Currency" },
    ],
    rows: [
      [456.78, "Virtual Machines", "2026-04-26", "USD"],
      [123.45, "Azure OpenAI Service", "2026-04-26", "USD"],
      [0, "Storage", "2026-04-26", "USD"],
    ],
  },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = mock(
  async () => new Response(JSON.stringify(FIXTURE), { status: 200 }),
) as unknown as typeof fetch;

mock.module("@azure/identity", () => ({
  DefaultAzureCredential: class {
    async getToken() {
      return { token: "fake-token" };
    }
  },
}));

mock.module("../../src/config.ts", () => ({
  loadConfig: () => ({
    providers: { azure: { enabled: true, subscription_id: "test-sub-id" } },
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
  getEnabledProviders: () => ["azure"],
  frequencyToIntervalMs: () => 86400000,
}));

let provider: CostProvider;

beforeAll(async () => {
  const { getProvider } = await import("../../src/providers/index.ts");
  await import("../../src/providers/azure.ts");
  provider = getProvider("azure")!;
});

describe("Azure provider", () => {
  test("parses Cost Management columnar response", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.service).toBe("Virtual Machines");
    expect(entries[0]!.amount_usd).toBe(456.78);
    expect(entries[1]!.service).toBe("Azure OpenAI Service");
  });

  test("skips zero-cost services", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    const storage = entries.find((e) => e.service === "Storage");
    expect(storage).toBeUndefined();
  });

  test("preflight returns healthy with valid credentials", async () => {
    const status = await provider.preflight();
    expect(status.healthy).toBe(true);
  });
});
