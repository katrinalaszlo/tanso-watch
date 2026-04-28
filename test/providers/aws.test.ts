import { describe, test, expect, mock, beforeAll } from "bun:test";
import type { CostProvider } from "../../src/providers/index.ts";

const FIXTURE = {
  ResultsByTime: [
    {
      TimePeriod: { Start: "2026-04-26", End: "2026-04-27" },
      Groups: [
        {
          Keys: ["Amazon Bedrock"],
          Metrics: { UnblendedCost: { Amount: "890.50", Unit: "USD" } },
        },
        {
          Keys: ["Amazon EC2"],
          Metrics: { UnblendedCost: { Amount: "234.12", Unit: "USD" } },
        },
        {
          Keys: ["Amazon S3"],
          Metrics: { UnblendedCost: { Amount: "0.00", Unit: "USD" } },
        },
      ],
    },
  ],
};

const mockSend = mock(() => Promise.resolve(FIXTURE));

mock.module("@aws-sdk/client-cost-explorer", () => ({
  CostExplorerClient: class {
    send = mockSend;
  },
  GetCostAndUsageCommand: class {
    constructor(public input: unknown) {}
  },
}));

mock.module("../../src/config.ts", () => ({
  loadConfig: () => ({
    providers: { aws: { enabled: true, region: "us-east-1" } },
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
  getEnabledProviders: () => ["aws"],
  frequencyToIntervalMs: () => 86400000,
}));

let provider: CostProvider;

beforeAll(async () => {
  const { getProvider } = await import("../../src/providers/index.ts");
  await import("../../src/providers/aws.ts");
  provider = getProvider("aws")!;
});

describe("AWS provider", () => {
  test("parses Cost Explorer response into CostEntry array", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.provider).toBe("aws");
    expect(entries[0]!.service).toBe("Amazon Bedrock");
    expect(entries[0]!.amount_usd).toBe(890.5);
    expect(entries[0]!.date).toBe("2026-04-26");
    expect(entries[1]!.service).toBe("Amazon EC2");
    expect(entries[1]!.amount_usd).toBe(234.12);
  });

  test("skips zero-cost services", async () => {
    const entries = await provider.fetchCosts("2026-04-26", "2026-04-27");
    const s3 = entries.find((e) => e.service === "Amazon S3");
    expect(s3).toBeUndefined();
  });

  test("preflight returns healthy on success", async () => {
    const status = await provider.preflight();
    expect(status.healthy).toBe(true);
    expect(status.provider).toBe("aws");
  });
});
