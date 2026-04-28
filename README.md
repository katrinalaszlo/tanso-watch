# tanso-watch

CLI cost observability for cloud and AI spend. Catch cost drift before it compounds.

## What it does

Shows spend across AWS, GCP, Azure, OpenAI, and Anthropic. Escalating Slack alerts when costs drift up. Acknowledge flow to suppress false alarms.

No signup. No dashboard. Just a CLI that runs via cron.

**Honest about latency:** Cloud billing data arrives 8-24 hours late. tanso-watch catches drift (spend creeping up over days/weeks), not real-time spikes. For real-time cost blocking, see [Tanso Platform](https://tanso.dev).

## Requirements

- [Bun](https://bun.sh) >= 1.0

## Install

```bash
bun install -g tanso-watch
```

Then install the SDKs for your cloud providers:

```bash
# Only install what you use
bun install -g @aws-sdk/client-cost-explorer    # AWS
bun install -g @google-cloud/bigquery            # GCP
bun install -g @azure/identity                   # Azure
# OpenAI and Anthropic use fetch — no extra SDK needed
```

## Setup

```bash
tanso init
```

This will:
- Detect your cloud credentials
- Pick which providers to enable
- Set up Slack webhook for alerts
- Write a cron entry for hourly checks
- Generate an admin-request template if you're missing credentials

**Every provider requires admin-level billing access.** `tanso init` tells you exactly what's needed and generates a message you can send to your admin.

## Usage

```bash
# See current spend
tanso status

# Run a single cost check (this is what cron calls)
tanso watch --once

# Check cron status
tanso watch

# Manage alerts
tanso alerts list
tanso alerts config
tanso ack <alert-id>                    # suppress for 24h
tanso alerts raise <alert-id> <amount>  # permanently adjust threshold

# Manage providers
tanso providers list
tanso providers add
```

## How alerts work

tanso-watch doesn't just alert once. It escalates until you acknowledge:

| Daily spend | Alert frequency |
|------------|----------------|
| > $100/day | Once per day |
| > $500/day | 3x per day |
| > $1,000/day | 5x per day |
| > $5,000/day | Every hour |

When you get an alert, you can:
- `tanso ack <id>` to suppress for 24 hours
- `tanso alerts raise <id> 1500` to permanently set a higher threshold

If you ack and the spend is still above threshold after 24h, alerts resume.

## Providers

| Provider | Data source | Latency | Auth | Extra SDK |
|----------|------------|---------|------|-----------|
| AWS | Cost Explorer API | Up to 24h | IAM `ce:GetCostAndUsage` | `@aws-sdk/client-cost-explorer` |
| GCP | BigQuery billing export | Up to 24h | Service account or gcloud auth | `@google-cloud/bigquery` |
| Azure | Cost Management API | 8-24h | `az login` or service principal | `@azure/identity` |
| OpenAI | Organization Costs API | Near real-time | Admin key (`sk-admin-...`) | None |
| Anthropic | Cost Report API | ~5 minutes | Admin key (`sk-ant-admin-...`) | None |

## Config

Config lives at `~/.tanso/config.yaml`. Project-level overrides in `.tanso.yaml`.

```yaml
providers:
  aws:
    enabled: true
    region: us-east-1
  openai:
    enabled: true
    admin_key_env: OPENAI_ADMIN_KEY  # env var name, not the key itself

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
```

## Data storage

Cost data is stored locally in `~/.tanso/data.db` (SQLite). Nothing is sent anywhere. You own your data.

## Want more?

- [Observe](https://observe.tanso.dev) — open source dashboard for per-customer cost visibility (self-host)
- [Tanso Platform](https://tanso.dev) — managed platform with real-time cost blocking, team dashboards, and revenue aggregation

## License

MIT
