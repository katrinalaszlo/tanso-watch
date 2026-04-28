import type { FiredAlert } from "./engine.ts";

export async function sendSlackAlert(
  webhookUrl: string,
  alert: FiredAlert,
): Promise<void> {
  const providerLabel = alert.provider ?? "Total";
  const levelLabels = ["daily", "3x/day", "5x/day", "hourly"];
  const levelLabel = levelLabels[alert.escalation_level] ?? "daily";

  const serviceLines = alert.services
    .slice(0, 5)
    .map((s) => `${s.name} ($${s.amount.toFixed(2)})`)
    .join(", ");

  const text = [
    `[tanso-watch] ${providerLabel} cost drift: $${alert.amount.toFixed(2)}/day (threshold: $${alert.threshold}/day)`,
    `Services: ${serviceLines}`,
    `Escalation: Level ${alert.escalation_level} (alerting ${levelLabel} until acknowledged)`,
    `Run: \`tanso ack ${alert.rule_id.slice(0, 8)}\` (suppresses for 24h)`,
    `     \`tanso alerts raise ${alert.rule_id.slice(0, 8)} ${Math.ceil(alert.amount / 100) * 100}\` (permanently adjusts threshold)`,
  ].join("\n");

  const payload = { text };

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Slack webhook failed: ${resp.status} ${resp.statusText}`);
  }
}
