import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import { setDb, closeDb } from "../../src/db.ts";
import { evaluateAlerts } from "../../src/alerts/engine.ts";

const mockConfig = {
  providers: {},
  alerts: {
    slack_webhook_url_env: "TANSO_SLACK_WEBHOOK",
    default_threshold: 100,
    escalation: [
      { above: 100, frequency: "daily" as const },
      { above: 500, frequency: "3x_daily" as const },
      { above: 1000, frequency: "5x_daily" as const },
      { above: 5000, frequency: "hourly" as const },
    ],
    acknowledge_ttl: "24h",
  },
  polling: { interval: 3600 },
};

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cost_snapshots (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL, service TEXT NOT NULL, date TEXT NOT NULL,
      amount_usd REAL NOT NULL, raw_response TEXT, fetched_at TEXT NOT NULL,
      UNIQUE(provider, service, date)
    );
    CREATE TABLE alert_events (
      id TEXT PRIMARY KEY, rule_id TEXT, provider TEXT, service TEXT,
      amount_usd REAL, threshold_usd REAL, escalation_level INTEGER,
      action TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE alert_rules (
      id TEXT PRIMARY KEY, provider TEXT, service TEXT,
      threshold_usd_per_day REAL NOT NULL, enabled INTEGER DEFAULT 1,
      acknowledged_at TEXT, acknowledged_until TEXT, created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertRule(
  db: Database,
  overrides: Partial<{
    id: string;
    provider: string | null;
    service: string | null;
    threshold: number;
    enabled: number;
    ack_at: string | null;
    ack_until: string | null;
  }> = {},
): string {
  const id = overrides.id ?? nanoid();
  db.prepare(
    `
    INSERT INTO alert_rules (id, provider, service, threshold_usd_per_day, enabled, acknowledged_at, acknowledged_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    overrides.provider ?? null,
    overrides.service ?? null,
    overrides.threshold ?? 100,
    overrides.enabled ?? 1,
    overrides.ack_at ?? null,
    overrides.ack_until ?? null,
    new Date().toISOString(),
  );
  return id;
}

let testDb: Database;

beforeEach(() => {
  testDb = createTestDb();
  setDb(testDb);
});

afterEach(() => {
  closeDb();
});

describe("Alert engine", () => {
  test("fires alert when spend exceeds threshold", () => {
    const ruleId = insertRule(testDb, { threshold: 100 });
    const spend = [
      { provider: "aws", service: "EC2", date: "2026-04-26", amount_usd: 150 },
    ];
    const alerts = evaluateAlerts(mockConfig, spend);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.amount).toBe(150);
    expect(alerts[0]!.threshold).toBe(100);
    expect(alerts[0]!.rule_id).toBe(ruleId);
  });

  test("does not fire when spend is below threshold", () => {
    insertRule(testDb, { threshold: 200 });
    const spend = [
      { provider: "aws", service: "EC2", date: "2026-04-26", amount_usd: 50 },
    ];
    const alerts = evaluateAlerts(mockConfig, spend);
    expect(alerts).toHaveLength(0);
  });

  test("skips acknowledged alerts within TTL", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    insertRule(testDb, {
      threshold: 100,
      ack_at: new Date().toISOString(),
      ack_until: future,
    });
    const spend = [
      { provider: "aws", service: "EC2", date: "2026-04-26", amount_usd: 500 },
    ];
    const alerts = evaluateAlerts(mockConfig, spend);
    expect(alerts).toHaveLength(0);
  });

  test("re-alerts after ack expires", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    insertRule(testDb, { threshold: 100, ack_at: past, ack_until: past });
    const spend = [
      { provider: "aws", service: "EC2", date: "2026-04-26", amount_usd: 500 },
    ];
    const alerts = evaluateAlerts(mockConfig, spend);
    expect(alerts).toHaveLength(1);
  });

  test("escalation level matches spend amount", () => {
    insertRule(testDb, { threshold: 100 });
    const spend = [
      {
        provider: "aws",
        service: "Bedrock",
        date: "2026-04-26",
        amount_usd: 1200,
      },
    ];
    const alerts = evaluateAlerts(mockConfig, spend);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.escalation_level).toBe(2);
  });

  test("provider-scoped rule only matches that provider", () => {
    insertRule(testDb, { threshold: 50, provider: "openai" });
    const spend = [
      { provider: "aws", service: "EC2", date: "2026-04-26", amount_usd: 500 },
      {
        provider: "openai",
        service: "gpt-4o",
        date: "2026-04-26",
        amount_usd: 30,
      },
    ];
    const alerts = evaluateAlerts(mockConfig, spend);
    expect(alerts).toHaveLength(0);
  });
});
