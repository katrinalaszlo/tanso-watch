import { registerProvider } from "./index.ts";
import type { CostProvider, CostEntry, ProviderStatus } from "./index.ts";
import { loadConfig, resolveEnvVar } from "../config.ts";

function getAdminKey(): string | null {
  const config = loadConfig();
  const envName = config.providers.openai?.admin_key_env ?? "OPENAI_ADMIN_KEY";
  return resolveEnvVar(envName) ?? null;
}

const openai: CostProvider = {
  name: "openai",

  async preflight(): Promise<ProviderStatus> {
    const key = getAdminKey();
    if (!key) {
      return {
        provider: "openai",
        healthy: false,
        error: "OPENAI_ADMIN_KEY env var not set",
      };
    }
    if (!key.startsWith("sk-admin-")) {
      return {
        provider: "openai",
        healthy: false,
        error: "Key must be an admin key (sk-admin-...), not a regular API key",
      };
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const oneDayAgo = now - 86400;
      const url = `https://api.openai.com/v1/organization/costs?start_time=${oneDayAgo}&bucket_width=1d&limit=1`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!resp.ok) {
        const body = await resp.text();
        return {
          provider: "openai",
          healthy: false,
          error: `API returned ${resp.status}: ${body.slice(0, 200)}`,
        };
      }
      return { provider: "openai", healthy: true };
    } catch (err) {
      return {
        provider: "openai",
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fetchCosts(startDate: string, endDate: string): Promise<CostEntry[]> {
    const key = getAdminKey();
    if (!key) throw new Error("OPENAI_ADMIN_KEY not set");

    const startUnix = Math.floor(new Date(startDate).getTime() / 1000);
    const url = `https://api.openai.com/v1/organization/costs?start_time=${startUnix}&bucket_width=1d&group_by[]=line_item`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!resp.ok) {
      throw new Error(
        `OpenAI Costs API error: ${resp.status} ${resp.statusText}`,
      );
    }

    const data = (await resp.json()) as {
      data?: Array<{
        start_time?: number;
        results?: Array<{
          line_item?: string;
          amount?: { value?: number };
        }>;
      }>;
    };

    const entries: CostEntry[] = [];
    for (const bucket of data.data ?? []) {
      const date = bucket.start_time
        ? new Date(bucket.start_time * 1000).toISOString().split("T")[0]!
        : startDate;

      for (const result of bucket.results ?? []) {
        const amount = result.amount?.value ?? 0;
        if (amount === 0) continue;
        entries.push({
          provider: "openai",
          service: result.line_item ?? "Unknown",
          date,
          amount_usd: amount,
          raw_response: JSON.stringify(result),
        });
      }
    }
    return entries;
  },
};

registerProvider(openai);
