# tanso-watch Spec

## Purpose

CLI cost observability tool. Shows cloud + AI spend across AWS, GCP, Azure, OpenAI, Anthropic. Escalating Slack alerts when cost drift is detected. Ack flow to suppress false alarms. Cron-based, not daemon. No web dashboard. No org setup.

POSITIONING: "Catch cost drift early" not "prevent cost spikes." Cloud billing data arrives 8-24h late. This catches drift, not real-time spikes.

## Non-Goals

- No web dashboard (link to Observe)
- No team/org features
- No historical trend visualization (data in SQLite, users query directly)
- No billing/payment (MIT, fully free)
- No long-running daemon process
- No per-customer margin tracking (upsell to Tanso Platform)

## Architecture

```
tanso-watch/
  src/
    cli.ts              # Entry point, Commander.js
    config.ts           # Config loader (~/.tanso/config.yaml + .tanso.yaml)
    db.ts               # SQLite local store (better-sqlite3, NOT bun:sqlite)
    providers/
      index.ts          # Provider registry + shared types
      aws.ts            # AWS Cost Explorer API
      gcp.ts            # GCP BigQuery billing export
      azure.ts          # Azure Cost Management API
      openai.ts         # OpenAI Organization Costs API
      anthropic.ts      # Anthropic Cost Report API
    alerts/
      engine.ts         # Threshold evaluation + escalation curve
      slack.ts          # Slack webhook delivery
      acknowledge.ts    # Ack/suppress/raise flow
    cron-setup.ts       # Write/manage crontab entry for `tanso watch --once`
  test/
    providers/          # One test file per provider with fixtures
    alerts/             # Alert engine + escalation tests
    e2e/                # 3 E2E scenarios
  .github/
    workflows/
      ci.yml            # Test on PR, publish to npm on tag push
  package.json
  tsconfig.json
  README.md
  LICENSE               # MIT
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `tanso init` | Interactive setup: detect creds, pick providers, set Slack webhook, write crontab, generate admin-request template if creds missing |
| `tanso status` | One-screen spend summary: per-provider, per-service, daily/MTD/monthly |
| `tanso watch --once` | THE core command. Single check, print results, exit. Runs via cron. |
| `tanso watch` | Shows crontab status and last run time. Does NOT start a daemon. |
| `tanso alerts config` | Set/edit thresholds and escalation rules |
| `tanso alerts list` | Show active alerts and escalation state |
| `tanso alerts raise <id> <new-threshold>` | Permanently adjust threshold (instead of re-acking forever) |
| `tanso ack <alert-id>` | Acknowledge cost drift (suppress for TTL) |
| `tanso providers list` | Show configured providers and connection status |
| `tanso providers add` | Add a new provider interactively |
| `tanso link` | Print URLs to Observe dashboard and Tanso platform |

## Config Format (~/.tanso/config.yaml)

```yaml
providers:
  aws:
    enabled: true
    region: us-east-1
  gcp:
    enabled: true
    project_id: my-project
    billing_dataset: billing_export.gcp_billing_export_v1
  azure:
    enabled: false
    subscription_id: xxx
  openai:
    enabled: true
    admin_key_env: OPENAI_ADMIN_KEY
  anthropic:
    enabled: true
    admin_key_env: ANTHROPIC_ADMIN_KEY

alerts:
  slack_webhook_url_env: TANSO_SLACK_WEBHOOK
  default_threshold: 100
  escalation:
    - above: 100
      frequency: daily
    - above: 500
      frequency: 3x_daily
    - above: 1000
      frequency: 5x_daily
    - above: 5000
      frequency: hourly
  acknowledge_ttl: 24h

polling:
  interval: 3600
  quiet_hours:
    start: "22:00"
    end: "07:00"
    timezone: America/Los_Angeles
```

## Provider API Details

### AWS Cost Explorer
- SDK: @aws-sdk/client-cost-explorer
- Auth: AWS Signature V4 (default credential chain)
- IAM: ce:GetCostAndUsage (root must enable "IAM Access to Billing")
- Call: GetCostAndUsage({ TimePeriod: {Start, End}, Granularity: "DAILY", Metrics: ["UnblendedCost"], GroupBy: [{Type: "DIMENSION", Key: "SERVICE"}] })
- Response: ResultsByTime[].Groups[].Keys (service) + Metrics.UnblendedCost.Amount (USD string)
- Rate limit: ~5 req/s. Cache results.
- Latency: up to 24h

### GCP (BigQuery billing export)
- SDK: @google-cloud/bigquery
- Auth: GOOGLE_APPLICATION_CREDENTIALS or gcloud auth application-default
- Permissions: roles/billing.viewer + roles/bigquery.dataViewer + roles/bigquery.jobUser
- Query: SELECT service.description, SUM(cost) as total_cost, SUM(credits.amount) as total_credits FROM `{dataset}` WHERE DATE(usage_start_time) = @date GROUP BY 1
- Detection: Check billing export exists via BigQuery information_schema. Show setup guide if not.
- Latency: <24h typical, up to 5 days retroactive

### Azure Cost Management
- Endpoint: POST https://management.azure.com/subscriptions/{subId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01
- Auth: @azure/identity DefaultAzureCredential
- Body: { type: "Usage", timeframe: "Custom", timePeriod: {from, to}, dataset: { granularity: "Daily", aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } }, grouping: [{ type: "Dimension", name: "ServiceName" }] } }
- Response: properties.rows[][] (columnar: [cost, serviceName, date, currency])
- Latency: 8-24h

### OpenAI Costs
- Endpoint: GET https://api.openai.com/v1/organization/costs?start_time={unix}&bucket_width=1d&group_by[]=line_item
- Auth: Authorization: Bearer {ADMIN_KEY} (sk-admin-... key, NOT regular API key)
- Response: data[].results[].amount.value (USD float) + line_item
- Near real-time latency

### Anthropic Costs
- Endpoint: GET https://api.anthropic.com/v1/organizations/cost_report?starting_at={iso}&ending_at={iso}&group_by[]=description
- Auth: x-api-key: {ADMIN_KEY} (sk-ant-admin-...) + anthropic-version: 2023-06-01
- Response: cost data with model breakdown
- ~5 minute latency

## SQLite Schema (~/.tanso/data.db) — better-sqlite3

```sql
CREATE TABLE cost_snapshots (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  raw_response TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE(provider, service, date)
);

CREATE TABLE alert_events (
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

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  provider TEXT,
  service TEXT,
  threshold_usd_per_day REAL NOT NULL,
  enabled INTEGER DEFAULT 1,
  acknowledged_at TEXT,
  acknowledged_until TEXT,
  created_at TEXT NOT NULL
);
```

## Alert Escalation Engine

Escalation logic:
1. On each poll, compute daily spend per provider/service
2. For each active rule, check if spend > threshold
3. If above threshold AND not acknowledged:
   a. Determine escalation level from config
   b. Check if enough time has passed since last alert for this level
   c. Send Slack message with: provider, service, amount, threshold, level, ack command
4. If acknowledged AND ack not expired: skip
5. If acknowledged AND ack expired AND still above threshold: re-enter escalation at level 0

Slack message format:
```
[tanso-watch] AWS cost drift: $1,247/day (threshold: $1,000)
Services: Amazon Bedrock ($890), EC2 ($234), S3 ($123)
Escalation: Level 2 (alerting 5x/day until acknowledged)
Run: tanso ack abc123 (suppresses for 24h)
     tanso alerts raise abc123 1500 (permanently adjusts threshold)
```

## Preflight Validation

Every `tanso watch --once` run:
1. Load config
2. For each enabled provider, validate credentials (lightweight API call or auth check)
3. Report healthy vs degraded providers before fetching costs
4. Skip degraded providers, continue with healthy ones
5. Log preflight results to SQLite for `tanso status` to display

## Cron Setup (cron-setup.ts)

`tanso init` writes a crontab entry:
```
0 * * * * /path/to/tanso watch --once >> ~/.tanso/tanso-watch.log 2>&1
```
`tanso watch` (no --once) reads crontab to show status + last run from log.

## Admin Request Template

When `tanso init` detects missing credentials, generate a copy-paste message:
```
Hi [admin name],

I'm setting up cost monitoring with tanso-watch. I need read-only billing access:

AWS: Enable "IAM Access to Billing" in root account, then attach ce:GetCostAndUsage policy
GCP: Grant roles/billing.viewer + roles/bigquery.dataViewer on billing dataset
OpenAI: Generate an admin API key (sk-admin-...) at platform.openai.com/settings
Anthropic: Generate an admin API key (sk-ant-admin-...) at console.anthropic.com

This is read-only access. The tool runs locally and never sends cost data anywhere.
```

## Acceptance Criteria

- [ ] `npm install -g tanso-watch && tanso init` completes in <60s
- [ ] `tanso init` detects missing creds and generates admin-request template
- [ ] `tanso init` writes crontab entry for hourly runs
- [ ] `tanso init` checks GCP billing export via information_schema
- [ ] `tanso status` shows per-provider, per-service spend for today + MTD
- [ ] `tanso watch --once` runs preflight, fetches all healthy providers, stores in SQLite
- [ ] `tanso watch` (no flag) shows cron status and last run time
- [ ] Alert engine escalates through 4 levels based on spend thresholds
- [ ] `tanso ack <id>` suppresses alerts for configured TTL
- [ ] `tanso alerts raise <id> <threshold>` permanently adjusts threshold
- [ ] Expired acks re-trigger escalation at level 0
- [ ] Slack webhook delivers formatted messages with ack + raise commands
- [ ] Each provider handles auth failure gracefully (log + skip, continue others)
- [ ] Config loads from ~/.tanso/config.yaml with .tanso.yaml override
- [ ] SQLite UPSERT on (provider, service, date) prevents duplicates
- [ ] `tanso link` prints Observe + Tanso Platform URLs
- [ ] All 5 providers parse their respective API responses correctly
- [ ] GitHub Actions: tests on PR, npm publish on tag push
- [ ] better-sqlite3 used (works on Node.js), NOT bun:sqlite

## Dependencies

- commander — CLI framework
- js-yaml — YAML parsing
- better-sqlite3 — SQLite (Node.js compatible)
- @aws-sdk/client-cost-explorer — AWS provider
- @google-cloud/bigquery — GCP provider
- @azure/identity — Azure auth
- chalk — Terminal colors
- ora — Spinners
- nanoid — Alert ID generation
