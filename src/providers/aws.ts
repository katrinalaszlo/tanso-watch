import { registerProvider } from "./index.ts";
import type { CostProvider, CostEntry, ProviderStatus } from "./index.ts";
import { loadConfig, resolveEnvVar } from "../config.ts";

let CostExplorerClient: any;
let GetCostAndUsageCommand: any;

async function loadSdk() {
  if (CostExplorerClient) return;
  try {
    const mod = await import("@aws-sdk/client-cost-explorer");
    CostExplorerClient = mod.CostExplorerClient;
    GetCostAndUsageCommand = mod.GetCostAndUsageCommand;
  } catch {
    throw new Error(
      "@aws-sdk/client-cost-explorer not installed. Run: npm install @aws-sdk/client-cost-explorer",
    );
  }
}

const aws: CostProvider = {
  name: "aws",

  async preflight(): Promise<ProviderStatus> {
    try {
      await loadSdk();
      const config = loadConfig();
      const region = config.providers.aws?.region ?? "us-east-1";
      const client = new CostExplorerClient({ region });
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);
      await client.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: yesterday.toISOString().split("T")[0],
            End: today.toISOString().split("T")[0],
          },
          Granularity: "DAILY",
          Metrics: ["UnblendedCost"],
        }),
      );
      return { provider: "aws", healthy: true };
    } catch (err) {
      return {
        provider: "aws",
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fetchCosts(startDate: string, endDate: string): Promise<CostEntry[]> {
    await loadSdk();
    const config = loadConfig();
    const region = config.providers.aws?.region ?? "us-east-1";
    const client = new CostExplorerClient({ region });

    const response = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      }),
    );

    const entries: CostEntry[] = [];
    for (const period of response.ResultsByTime ?? []) {
      const date = period.TimePeriod?.Start;
      if (!date) continue;
      for (const group of period.Groups ?? []) {
        const service = group.Keys?.[0] ?? "Unknown";
        const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? "0");
        if (amount === 0) continue;
        entries.push({
          provider: "aws",
          service,
          date,
          amount_usd: amount,
          raw_response: JSON.stringify(group),
        });
      }
    }
    return entries;
  },
};

registerProvider(aws);
