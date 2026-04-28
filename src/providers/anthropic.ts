import { registerProvider } from "./index.ts";
import type { CostProvider, CostEntry, ProviderStatus } from "./index.ts";
import { loadConfig, resolveEnvVar } from "../config.ts";

function getAdminKey(): string | null {
  const config = loadConfig();
  const envName =
    config.providers.anthropic?.admin_key_env ?? "ANTHROPIC_ADMIN_KEY";
  return resolveEnvVar(envName) ?? null;
}

const anthropic: CostProvider = {
  name: "anthropic",

  async preflight(): Promise<ProviderStatus> {
    const key = getAdminKey();
    if (!key) {
      return {
        provider: "anthropic",
        healthy: false,
        error: "ANTHROPIC_ADMIN_KEY env var not set",
      };
    }
    if (!key.startsWith("sk-ant-admin-")) {
      return {
        provider: "anthropic",
        healthy: false,
        error:
          "Key must be an admin key (sk-ant-admin-...), not a regular API key",
      };
    }

    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 86400000);
      const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${oneDayAgo.toISOString()}&ending_at=${now.toISOString()}&group_by[]=description`;
      const resp = await fetch(url, {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!resp.ok) {
        const body = await resp.text();
        return {
          provider: "anthropic",
          healthy: false,
          error: `API returned ${resp.status}: ${body.slice(0, 200)}`,
        };
      }
      return { provider: "anthropic", healthy: true };
    } catch (err) {
      return {
        provider: "anthropic",
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async fetchCosts(startDate: string, endDate: string): Promise<CostEntry[]> {
    const key = getAdminKey();
    if (!key) throw new Error("ANTHROPIC_ADMIN_KEY not set");

    const startIso = new Date(startDate).toISOString();
    const endIso = new Date(endDate + "T23:59:59Z").toISOString();
    const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${startIso}&ending_at=${endIso}&group_by[]=description`;

    const resp = await fetch(url, {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!resp.ok) {
      throw new Error(
        `Anthropic Cost Report API error: ${resp.status} ${resp.statusText}`,
      );
    }

    const data = (await resp.json()) as {
      data?: Array<{
        description?: string;
        cost_usd?: number;
        date?: string;
      }>;
    };

    const entries: CostEntry[] = [];
    for (const item of data.data ?? []) {
      const amount = item.cost_usd ?? 0;
      if (amount === 0) continue;
      entries.push({
        provider: "anthropic",
        service: item.description ?? "Unknown",
        date: item.date ?? startDate,
        amount_usd: amount,
        raw_response: JSON.stringify(item),
      });
    }
    return entries;
  },
};

registerProvider(anthropic);
