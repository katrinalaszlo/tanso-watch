import { registerProvider } from "./index.ts";
import type { CostProvider, CostEntry, ProviderStatus } from "./index.ts";
import { loadConfig } from "../config.ts";

let DefaultAzureCredential: any;

async function loadSdk() {
  if (DefaultAzureCredential) return;
  try {
    const mod = await import("@azure/identity");
    DefaultAzureCredential = mod.DefaultAzureCredential;
  } catch {
    throw new Error(
      "@azure/identity not installed. Run: npm install @azure/identity",
    );
  }
}

async function getToken(): Promise<string> {
  await loadSdk();
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken(
    "https://management.azure.com/.default",
  );
  return tokenResponse.token;
}

const azure: CostProvider = {
  name: "azure",

  async preflight(): Promise<ProviderStatus> {
    try {
      const config = loadConfig();
      const azureConfig = config.providers.azure;
      if (!azureConfig?.subscription_id) {
        return {
          provider: "azure",
          healthy: false,
          error: "Missing subscription_id in config",
        };
      }
      await getToken();
      return { provider: "azure", healthy: true };
    } catch (err) {
      return {
        provider: "azure",
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fetchCosts(startDate: string, endDate: string): Promise<CostEntry[]> {
    const config = loadConfig();
    const azureConfig = config.providers.azure;
    if (!azureConfig?.subscription_id) {
      throw new Error("Azure provider not configured: missing subscription_id");
    }

    const token = await getToken();
    const url = `https://management.azure.com/subscriptions/${azureConfig.subscription_id}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`;

    const body = {
      type: "Usage",
      timeframe: "Custom",
      timePeriod: {
        from: `${startDate}T00:00:00Z`,
        to: `${endDate}T23:59:59Z`,
      },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
        grouping: [{ type: "Dimension", name: "ServiceName" }],
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(
        `Azure Cost Management API error: ${resp.status} ${resp.statusText}`,
      );
    }

    const data = (await resp.json()) as {
      properties?: {
        columns?: Array<{ name: string }>;
        rows?: Array<Array<number | string>>;
      };
    };

    const columns = data.properties?.columns ?? [];
    const rows = data.properties?.rows ?? [];

    const costIdx = columns.findIndex((c) => c.name === "PreTaxCost");
    const serviceIdx = columns.findIndex((c) => c.name === "ServiceName");
    const dateIdx = columns.findIndex((c) => c.name === "UsageDate");

    const entries: CostEntry[] = [];
    for (const row of rows) {
      const cost = Number(row[costIdx] ?? 0);
      if (cost === 0) continue;

      const service = String(row[serviceIdx] ?? "Unknown");
      const rawDate = String(row[dateIdx] ?? startDate);
      const date = rawDate.length >= 10 ? rawDate.slice(0, 10) : rawDate;

      entries.push({
        provider: "azure",
        service,
        date,
        amount_usd: cost,
        raw_response: JSON.stringify(row),
      });
    }
    return entries;
  },
};

registerProvider(azure);
