import { registerProvider } from "./index.ts";
import type { CostProvider, CostEntry, ProviderStatus } from "./index.ts";
import { loadConfig } from "../config.ts";

let BigQuery: any;

async function loadSdk() {
  if (BigQuery) return;
  try {
    const mod = await import("@google-cloud/bigquery");
    BigQuery = mod.BigQuery;
  } catch {
    throw new Error(
      "@google-cloud/bigquery not installed. Run: npm install @google-cloud/bigquery",
    );
  }
}

const gcp: CostProvider = {
  name: "gcp",

  async preflight(): Promise<ProviderStatus> {
    try {
      await loadSdk();
      const config = loadConfig();
      const gcpConfig = config.providers.gcp;
      if (!gcpConfig?.project_id || !gcpConfig?.billing_dataset) {
        return {
          provider: "gcp",
          healthy: false,
          error: "Missing project_id or billing_dataset in config",
        };
      }
      const client = new BigQuery({ projectId: gcpConfig.project_id });

      const dataset = gcpConfig.billing_dataset.split(".")[0];
      if (!dataset) {
        return {
          provider: "gcp",
          healthy: false,
          error: "Invalid billing_dataset format",
        };
      }

      const [tables] = await client.dataset(dataset).getTables();
      if (!tables || tables.length === 0) {
        return {
          provider: "gcp",
          healthy: false,
          error: `No tables found in dataset "${dataset}". Billing export may not be enabled. See: https://cloud.google.com/billing/docs/how-to/export-data-bigquery`,
        };
      }
      return { provider: "gcp", healthy: true };
    } catch (err) {
      return {
        provider: "gcp",
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fetchCosts(startDate: string, endDate: string): Promise<CostEntry[]> {
    await loadSdk();
    const config = loadConfig();
    const gcpConfig = config.providers.gcp;
    if (!gcpConfig?.project_id || !gcpConfig?.billing_dataset) {
      throw new Error(
        "GCP provider not configured: missing project_id or billing_dataset",
      );
    }

    const client = new BigQuery({ projectId: gcpConfig.project_id });

    const query = `
      SELECT
        service.description as service_name,
        DATE(usage_start_time) as usage_date,
        SUM(cost) as total_cost,
        SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) as total_credits
      FROM \`${gcpConfig.billing_dataset}\`
      WHERE DATE(usage_start_time) BETWEEN @startDate AND @endDate
      GROUP BY service_name, usage_date
      ORDER BY total_cost DESC
    `;

    const [rows] = await client.query({
      query,
      params: { startDate, endDate },
    });

    const entries: CostEntry[] = [];
    for (const row of rows ?? []) {
      const netCost = (row.total_cost ?? 0) + (row.total_credits ?? 0);
      if (netCost === 0) continue;
      entries.push({
        provider: "gcp",
        service: row.service_name ?? "Unknown",
        date: row.usage_date?.value ?? startDate,
        amount_usd: netCost,
        raw_response: JSON.stringify(row),
      });
    }
    return entries;
  },
};

registerProvider(gcp);
