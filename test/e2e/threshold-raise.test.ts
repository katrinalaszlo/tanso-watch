import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import { setDb, closeDb } from "../../src/db.ts";
import { evaluateAlerts } from "../../src/alerts/engine.ts";
import { raiseThreshold } from "../../src/alerts/acknowledge.ts";

const mockConfig = {
  providers: {},
  alerts: {
    slack_webhook_url_env: "TANSO_SLACK_WEBHOOK",
    default_threshold: 100,
    escalation: [
      { above: 100, frequency: "daily" as const },
      { above: 500, frequency: "3x_daily" as const },
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

describe("E2E: threshold raise", () => {
  test("alert fires -> raise threshold -> no more alerts at old spend level", () => {
    const ruleId = nanoid();
    db.prepare(
      `
      INSERT INTO alert_rules (id, provider, service, threshold_usd_per_day, enabled, created_at)
      VALUES (?, NULL, NULL, 100, 1, ?)
    `,
    ).run(ruleId, new Date().toISOString());

    const spend = [
      { provider: "aws", service: "EC2", date: "2026-04-26", amount_usd: 300 },
    ];

    const alerts1 = evaluateAlerts(mockConfig, spend);
    expect(alerts1).toHaveLength(1);
    expect(alerts1[0]!.threshold).toBe(100);

    raiseThreshold(ruleId, 500);

    const alerts2 = evaluateAlerts(mockConfig, spend);
    expect(alerts2).toHaveLength(0);
  });

  test("raise clears any existing acknowledgement", () => {
    const ruleId = nanoid();
    const future = new Date(Date.now() + 86400000).toISOString();
    db.prepare(
      `
      INSERT INTO alert_rules (id, provider, service, threshold_usd_per_day, enabled, acknowledged_at, acknowledged_until, created_at)
      VALUES (?, NULL, NULL, 100, 1, ?, ?, ?)
    `,
    ).run(ruleId, new Date().toISOString(), future, new Date().toISOString());

    raiseThreshold(ruleId, 500);

    const row = db
      .prepare(
        "SELECT acknowledged_at, acknowledged_until FROM alert_rules WHERE id = ?",
      )
      .get(ruleId) as any;
    expect(row.acknowledged_at).toBeNull();
    expect(row.acknowledged_until).toBeNull();
  });
});
