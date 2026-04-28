import { getDb } from "../db.ts";
import { nanoid } from "nanoid";

interface AlertRuleRow {
  id: string;
  provider: string | null;
  service: string | null;
  threshold_usd_per_day: number;
  enabled: number;
  acknowledged_at: string | null;
  acknowledged_until: string | null;
  created_at: string;
}

function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)([hmd])$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const val = parseInt(match[1]!, 10);
  switch (match[2]) {
    case "h":
      return val * 60 * 60 * 1000;
    case "m":
      return val * 60 * 1000;
    case "d":
      return val * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export function acknowledgeAlert(ruleId: string, ttl: string): void {
  const db = getDb();
  const now = new Date();
  const until = new Date(now.getTime() + parseTtl(ttl));

  db.prepare(
    `
    UPDATE alert_rules SET acknowledged_at = ?, acknowledged_until = ? WHERE id = ?
  `,
  ).run(now.toISOString(), until.toISOString(), ruleId);

  db.prepare(
    `
    INSERT INTO alert_events (id, rule_id, provider, service, amount_usd, threshold_usd, escalation_level, action, created_at)
    VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 'acknowledged', ?)
  `,
  ).run(nanoid(), ruleId, now.toISOString());
}

export function raiseThreshold(ruleId: string, newThreshold: number): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE alert_rules SET threshold_usd_per_day = ?, acknowledged_at = NULL, acknowledged_until = NULL WHERE id = ?
  `,
  ).run(newThreshold, ruleId);
}

export function getAlertRule(idPrefix: string): AlertRuleRow | null {
  const db = getDb();
  const exact = db
    .prepare("SELECT * FROM alert_rules WHERE id = ?")
    .get(idPrefix) as AlertRuleRow | undefined;
  if (exact) return exact;

  const byPrefix = db
    .prepare("SELECT * FROM alert_rules WHERE id LIKE ?")
    .get(`${idPrefix}%`) as AlertRuleRow | undefined;
  return byPrefix ?? null;
}

export function listAlertRules(): AlertRuleRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM alert_rules ORDER BY created_at")
    .all() as AlertRuleRow[];
}
