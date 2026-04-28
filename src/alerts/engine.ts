import type { TansoConfig, EscalationLevel } from "../config.ts";
import { frequencyToIntervalMs } from "../config.ts";
import type { DailySpend } from "../db.ts";
import { getDb } from "../db.ts";
import { nanoid } from "nanoid";

export interface FiredAlert {
  rule_id: string;
  provider: string | null;
  service: string | null;
  amount: number;
  threshold: number;
  escalation_level: number;
  services: Array<{ name: string; amount: number }>;
}

interface StoredRule {
  id: string;
  provider: string | null;
  service: string | null;
  threshold_usd_per_day: number;
  enabled: number;
  acknowledged_at: string | null;
  acknowledged_until: string | null;
  created_at: string;
}

export function evaluateAlerts(
  config: TansoConfig,
  dailySpend: DailySpend[],
): FiredAlert[] {
  const db = getDb();
  const rules = db
    .prepare("SELECT * FROM alert_rules WHERE enabled = 1")
    .all() as StoredRule[];
  const fired: FiredAlert[] = [];
  const now = new Date();

  if (rules.length === 0 && dailySpend.length > 0) {
    ensureDefaultRule(config);
    return evaluateAlerts(config, dailySpend);
  }

  for (const rule of rules) {
    if (isAcknowledged(rule, now)) continue;

    const matchingSpend = dailySpend.filter((s) => {
      if (rule.provider && s.provider !== rule.provider) return false;
      if (rule.service && s.service !== rule.service) return false;
      return true;
    });

    const totalAmount = matchingSpend.reduce((sum, s) => sum + s.amount_usd, 0);

    if (totalAmount <= rule.threshold_usd_per_day) {
      maybeResolve(rule.id, totalAmount);
      continue;
    }

    const escalationLevel = getEscalationLevel(
      config.alerts.escalation,
      totalAmount,
    );
    const interval = getIntervalForLevel(
      config.alerts.escalation,
      escalationLevel,
    );

    if (!shouldAlert(rule.id, interval, now)) continue;

    const services = matchingSpend
      .sort((a, b) => b.amount_usd - a.amount_usd)
      .map((s) => ({ name: s.service, amount: s.amount_usd }));

    fired.push({
      rule_id: rule.id,
      provider: rule.provider,
      service: rule.service,
      amount: totalAmount,
      threshold: rule.threshold_usd_per_day,
      escalation_level: escalationLevel,
      services,
    });

    recordAlertEvent(
      rule.id,
      rule.provider,
      rule.service,
      totalAmount,
      rule.threshold_usd_per_day,
      escalationLevel,
      "fired",
    );
  }

  return fired;
}

function ensureDefaultRule(config: TansoConfig): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT COUNT(*) as count FROM alert_rules")
    .get() as { count: number };
  if (existing.count > 0) return;

  db.prepare(
    `
    INSERT INTO alert_rules (id, provider, service, threshold_usd_per_day, enabled, created_at)
    VALUES (?, NULL, NULL, ?, 1, ?)
  `,
  ).run(nanoid(), config.alerts.default_threshold, new Date().toISOString());
}

function isAcknowledged(rule: StoredRule, now: Date): boolean {
  if (!rule.acknowledged_until) return false;
  return new Date(rule.acknowledged_until) > now;
}

function getEscalationLevel(
  escalation: EscalationLevel[],
  amount: number,
): number {
  let level = 0;
  for (let i = 0; i < escalation.length; i++) {
    if (amount > escalation[i]!.above) {
      level = i;
    }
  }
  return level;
}

function getIntervalForLevel(
  escalation: EscalationLevel[],
  level: number,
): number {
  const esc = escalation[level];
  if (!esc) return 24 * 60 * 60 * 1000;
  return frequencyToIntervalMs(esc.frequency);
}

function shouldAlert(ruleId: string, intervalMs: number, now: Date): boolean {
  const db = getDb();
  const lastEvent = db
    .prepare(
      `
    SELECT created_at FROM alert_events
    WHERE rule_id = ? AND action = 'fired'
    ORDER BY created_at DESC LIMIT 1
  `,
    )
    .get(ruleId) as { created_at: string } | undefined;

  if (!lastEvent) return true;

  const elapsed = now.getTime() - new Date(lastEvent.created_at).getTime();
  return elapsed >= intervalMs;
}

function recordAlertEvent(
  ruleId: string,
  provider: string | null,
  service: string | null,
  amount: number,
  threshold: number,
  escalationLevel: number,
  action: string,
): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO alert_events (id, rule_id, provider, service, amount_usd, threshold_usd, escalation_level, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    nanoid(),
    ruleId,
    provider,
    service,
    amount,
    threshold,
    escalationLevel,
    action,
    new Date().toISOString(),
  );
}

function maybeResolve(ruleId: string, amount: number): void {
  const db = getDb();
  const lastFired = db
    .prepare(
      `
    SELECT id FROM alert_events
    WHERE rule_id = ? AND action = 'fired'
    ORDER BY created_at DESC LIMIT 1
  `,
    )
    .get(ruleId) as { id: string } | undefined;

  if (!lastFired) return;

  const alreadyResolved = db
    .prepare(
      `
    SELECT id FROM alert_events
    WHERE rule_id = ? AND action = 'resolved'
    ORDER BY created_at DESC LIMIT 1
  `,
    )
    .get(ruleId) as { id: string } | undefined;

  if (alreadyResolved) return;

  recordAlertEvent(ruleId, null, null, amount, 0, 0, "resolved");
}
