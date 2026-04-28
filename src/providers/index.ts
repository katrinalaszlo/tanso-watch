export interface CostEntry {
  provider: string;
  service: string;
  date: string;
  amount_usd: number;
  raw_response?: string;
}

export interface ProviderStatus {
  provider: string;
  healthy: boolean;
  error?: string;
}

export interface CostProvider {
  name: string;
  preflight(): Promise<ProviderStatus>;
  fetchCosts(startDate: string, endDate: string): Promise<CostEntry[]>;
}

const registry = new Map<string, CostProvider>();

export function registerProvider(provider: CostProvider): void {
  registry.set(provider.name, provider);
}

export function getProvider(name: string): CostProvider | undefined {
  return registry.get(name);
}

export function getAllProviders(): CostProvider[] {
  return Array.from(registry.values());
}

export function getRegisteredNames(): string[] {
  return Array.from(registry.keys());
}
