import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { getTansoDir } from "./config.ts";

let db: Database | null = null;

export function getDbPath(): string {
  return join(getTansoDir(), "data.db");
}

export function getDb(): Database {
  if (db) return db;

  const dir = getTansoDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(getDbPath());
  db.exec("PRAGMA journal_mode = WAL");
  initSchema(db);
  return db;
}

export function setDb(database: Database): void {
  db = database;
}

function initSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cost_snapshots (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      raw_response TEXT,
      fetched_at TEXT NOT NULL,
      UNIQUE(provider, service, date)
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      provider TEXT,
      service TEXT,
      amount_usd REAL,
      threshold_usd REAL,
      escalation_level INTEGER,
      action TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      provider TEXT,
      service TEXT,
      threshold_usd_per_day REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      acknowledged_at TEXT,
      acknowledged_until TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function upsertCostSnapshot(
  provider: string,
  service: string,
  date: string,
  amount_usd: number,
  raw_response?: string,
): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO cost_snapshots (provider, service, date, amount_usd, raw_response, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, service, date)
       DO UPDATE SET amount_usd = excluded.amount_usd, raw_response = excluded.raw_response, fetched_at = excluded.fetched_at`,
    )
    .run(
      provider,
      service,
      date,
      amount_usd,
      raw_response ?? null,
      new Date().toISOString(),
    );
}

export interface DailySpend {
  provider: string;
  service: string;
  date: string;
  amount_usd: number;
}

export function getDailySpend(date: string): DailySpend[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT provider, service, date, amount_usd
       FROM cost_snapshots WHERE date = ?
       ORDER BY amount_usd DESC`,
    )
    .all(date) as DailySpend[];
}

export function getMtdSpend(): DailySpend[] {
  const database = getDb();
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const startDate = firstOfMonth.toISOString().split("T")[0]!;

  return database
    .prepare(
      `SELECT provider, service, SUM(amount_usd) as amount_usd, 'MTD' as date
       FROM cost_snapshots WHERE date >= ?
       GROUP BY provider, service
       ORDER BY amount_usd DESC`,
    )
    .all(startDate) as DailySpend[];
}

export function getLatestFetchTime(): string | null {
  const database = getDb();
  const row = database
    .prepare(`SELECT MAX(fetched_at) as latest FROM cost_snapshots`)
    .get() as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
