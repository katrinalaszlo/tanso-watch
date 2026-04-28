import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import {
  setDb,
  closeDb,
  upsertCostSnapshot,
  getDailySpend,
} from "../../src/db.ts";
import { evaluateAlerts } from "../../src/alerts/engine.ts";
import { acknowledgeAlert } from "../../src/alerts/acknowledge.ts";

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
      id INTEGER PRIMARY KEY, provider TEXT NOT NULL, service TEXT NOT NULL,
      date TEXT NOT NULL, amount_usd REAL NOT NULL, raw_response TEXT,
      fetched_at TEXT NOT NULL, UNIQUE(provider, service, date)
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

let db: Database;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
});

afterEach(() => {
  closeDb();
});

describe("E2E: full cycle", () => {
  test("store costs -> alert fires -> ack -> re-check suppressed", () => {
    upsertCostSnapshot("aws", "EC2", "2026-04-26", 250);
    upsertCostSnapshot("aws", "S3", "2026-04-26", 50);

    const spend = getDailySpend("2026-04-26");
    expect(spend).toHaveLength(2);

    const alerts1 = evaluateAlerts(mockConfig, spend);
    expect(alerts1).toHaveLength(1);
    expect(alerts1[0]!.amount).toBe(300);

    acknowledgeAlert(alerts1[0]!.rule_id, "24h");

    const alerts2 = evaluateAlerts(mockConfig, spend);
    expect(alerts2).toHaveLength(0);
  });

  test("upsert overwrites stale data on re-fetch", () => {
    upsertCostSnapshot("openai", "gpt-4o", "2026-04-26", 100);
    upsertCostSnapshot("openai", "gpt-4o", "2026-04-26", 200);

    const spend = getDailySpend("2026-04-26");
    expect(spend).toHaveLength(1);
    expect(spend[0]!.amount_usd).toBe(200);
  });
});
