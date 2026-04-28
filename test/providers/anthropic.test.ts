import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { CostProvider } from "../../src/providers/index.ts";

const FIXTURE = {
  data: [
    { description: "Claude Opus 4", cost_usd: 523.45, date: "2026-04-26" },
    { description: "Claude Sonnet 4", cost_usd: 89.12, date: "2026-04-26" },
    { description: "Claude Haiku 3.5", cost_usd: 0, date: "2026-04-26" },
  ],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = mock(
  async () => new Response(JSON.stringify(FIXTURE), { status: 200 }),
) as unknown as typeof fetch;

mock.module("../../src/config.ts", () => ({
  loadConfig: () => ({
    providers: {
      anthropic: { enabled: true, admin_key_env: "ANTHROPIC_ADMIN_KEY" },
    },
    alerts: {
      default_threshold: 100,
      escalation: [],
      acknowledge_ttl: "24h",
      slack_webhook_url_env: "",
    },
    polling: { interval: 3600 },
  }),
  resolveEnvVar: () => "sk-ant-admin-test-key-123",
  getTansoDir: () => "/tmp/tanso-test",
  getGlobalConfigPath: () => "/tmp/tanso-test/config.yaml",
  getLocalConfigPath: () => "/tmp/tanso-test/.tanso.yaml",
  configExists: () => true,
  getEnabledProviders: () => ["anthropic"],
  frequencyToIntervalMs: () => 86400000,
}));

let provider: CostProvider;

beforeAll(async () => {
  const { getProvider } = await import("../../src/providers/index.ts");
  await import("../../src/providers/anthropic.ts");
  provider = getProvider("anthropic")!;
});

describe("Anthropic provider", () => {
  test("parses Cost Report response", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.service).toBe("Claude Opus 4");
    expect(entries[0]!.amount_usd).toBe(523.45);
    expect(entries[0]!.date).toBe("2026-04-26");
    expect(entries[1]!.service).toBe("Claude Sonnet 4");
  });

  test("skips zero-cost models", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    const haiku = entries.find((e) => e.service === "Claude Haiku 3.5");
    expect(haiku).toBeUndefined();
  });

  test("preflight checks admin key prefix", async () => {
    const status = await provider.preflight();
    expect(status.healthy).toBe(true);
  });
});
