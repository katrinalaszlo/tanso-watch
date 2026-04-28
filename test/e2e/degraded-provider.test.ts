import { describe, test, expect, mock } from "bun:test";
import type {
  CostProvider,
  CostEntry,
  ProviderStatus,
} from "../../src/providers/index.ts";

function makeProvider(
  name: string,
  healthy: boolean,
  costs: CostEntry[] = [],
): CostProvider {
  return {
    name,
    async preflight(): Promise<ProviderStatus> {
      if (!healthy)
        return { provider: name, healthy: false, error: "Auth failed" };
      return { provider: name, healthy: true };
    },
    async fetchCosts(): Promise<CostEntry[]> {
      if (!healthy)
        throw new Error("Should not be called on unhealthy provider");
      return costs;
    },
  };
}

describe("E2E: degraded provider", () => {
  test("healthy providers continue when one fails preflight", async () => {
    const healthy = makeProvider("openai", true, [
      {
        provider: "openai",
        service: "gpt-4o",
        date: "2026-04-26",
        amount_usd: 145,
      },
    ]);
    const broken = makeProvider("aws", false);

    const providers = [healthy, broken];
    const results: CostEntry[] = [];
    const degraded: string[] = [];

    for (const p of providers) {
      const status = await p.preflight();
      if (!status.healthy) {
        degraded.push(`${p.name}: ${status.error}`);
        continue;
      }
      const entries = await p.fetchCosts("2026-04-26", "2026-04-27");
      results.push(...entries);
    }

    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain("aws");
    expect(results).toHaveLength(1);
    expect(results[0]!.provider).toBe("openai");
  });

  test("all providers failing returns empty results", async () => {
    const broken1 = makeProvider("aws", false);
    const broken2 = makeProvider("gcp", false);

    const providers = [broken1, broken2];
    const results: CostEntry[] = [];
    const degraded: string[] = [];

    for (const p of providers) {
      const status = await p.preflight();
      if (!status.healthy) {
        degraded.push(p.name);
        continue;
      }
      const entries = await p.fetchCosts("2026-04-26", "2026-04-27");
      results.push(...entries);
    }

    expect(degraded).toHaveLength(2);
    expect(results).toHaveLength(0);
  });
});
