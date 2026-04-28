import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { CostProvider } from "../../src/providers/index.ts";

const FIXTURE = {
  data: [
    {
      start_time: 1745625600,
      results: [
        { line_item: "gpt-4o", amount: { value: 145.23 } },
        { line_item: "gpt-4o-mini", amount: { value: 32.1 } },
        { line_item: "dall-e-3", amount: { value: 0 } },
      ],
    },
  ],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = mock(
  async () => new Response(JSON.stringify(FIXTURE), { status: 200 }),
) as unknown as typeof fetch;

mock.module("../../src/config.ts", () => ({
  loadConfig: () => ({
    providers: { openai: { enabled: true, admin_key_env: "OPENAI_ADMIN_KEY" } },
    alerts: {
      default_threshold: 100,
      escalation: [],
      acknowledge_ttl: "24h",
      slack_webhook_url_env: "",
    },
    polling: { interval: 3600 },
  }),
  resolveEnvVar: () => "sk-admin-test-key-123",
  getTansoDir: () => "/tmp/tanso-test",
  getGlobalConfigPath: () => "/tmp/tanso-test/config.yaml",
  getLocalConfigPath: () => "/tmp/tanso-test/.tanso.yaml",
  configExists: () => true,
  getEnabledProviders: () => ["openai"],
  frequencyToIntervalMs: () => 86400000,
}));

let provider: CostProvider;

beforeAll(async () => {
  const { getProvider } = await import("../../src/providers/index.ts");
  await import("../../src/providers/openai.ts");
  provider = getProvider("openai")!;
});

describe("OpenAI provider", () => {
  test("parses Organization Costs response", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.service).toBe("gpt-4o");
    expect(entries[0]!.amount_usd).toBe(145.23);
    expect(entries[1]!.service).toBe("gpt-4o-mini");
    expect(entries[1]!.amount_usd).toBe(32.1);
  });

  test("skips zero-amount items", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    const dalle = entries.find((e) => e.service === "dall-e-3");
    expect(dalle).toBeUndefined();
  });

  test("preflight succeeds with valid admin key", async () => {
    const status = await provider.preflight();
    expect(status.healthy).toBe(true);
  });
});
