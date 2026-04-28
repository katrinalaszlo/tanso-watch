# tanso-watch TODO

## Phase 1: Scaffold (single agent)
- [ ] Init bun project, package.json with bin field, tsconfig.json, LICENSE (MIT)
  Verify: `bun run build` succeeds
- [ ] src/cli.ts — Commander.js skeleton with all commands stubbed
  Verify: `bun run src/cli.ts --help` shows all commands
- [ ] src/config.ts — YAML loader (~/.tanso/config.yaml + .tanso.yaml merge)
  Verify: unit test — loads sample YAML, merges local override, resolves env var names
- [ ] src/db.ts — better-sqlite3 setup, schema creation, UPSERT helpers
  Verify: unit test — creates tables, inserts, upserts, queries
- [ ] src/providers/index.ts — Provider interface + registry
  Verify: types compile, registry accepts mock provider

## Phase 2: Providers (5 parallel agents — one file each)
- [ ] src/providers/aws.ts — AWS Cost Explorer via @aws-sdk/client-cost-explorer
  Verify: unit test with fixture response, parses services + amounts
- [ ] src/providers/gcp.ts — GCP BigQuery billing export, billing-export detection via information_schema
  Verify: unit test with fixture response, parses services + costs + credits
- [ ] src/providers/azure.ts — Azure Cost Management API via fetch + @azure/identity
  Verify: unit test with fixture response, parses columnar rows
- [ ] src/providers/openai.ts — OpenAI Organization Costs API
  Verify: unit test with fixture response, parses line_items + amounts
- [ ] src/providers/anthropic.ts — Anthropic Cost Report API
  Verify: unit test with fixture response, parses model breakdown

## Phase 3: Alert engine (single agent)
- [ ] src/alerts/engine.ts — threshold evaluation, escalation level calculation, ack/expire logic
  Verify: unit test — escalation progression, ack suppression, ack expiry re-triggers at level 0
- [ ] src/alerts/acknowledge.ts — ack command handler, raise command handler (permanent threshold adjust)
  Verify: unit test — ack writes to DB, raise updates threshold, expired ack re-enters escalation

## Phase 4: Slack delivery (single agent)
- [ ] src/alerts/slack.ts — webhook POST, message formatting with ack + raise commands
  Verify: unit test — correct payload shape, includes escalation level, ack command, raise command

## Phase 5: Cron + Init (single agent)
- [ ] src/cron-setup.ts — read/write/remove crontab entry for `tanso watch --once`
  Verify: unit test — generates correct crontab line, detects existing entry
- [ ] Wire `tanso init` — interactive flow: detect creds, pick providers, Slack webhook, crontab, admin-request template
  Verify: manual test with mocked prompts
- [ ] Wire `tanso watch --once` — preflight validation, fetch all healthy providers, store snapshots, evaluate alerts
  Verify: unit test with mocked providers
- [ ] Wire `tanso watch` (no flag) — show cron status + last run time from log
  Verify: manual test
- [ ] Wire `tanso status` — query SQLite, format per-provider/service/daily/MTD table
  Verify: unit test with seeded DB
- [ ] Wire `tanso ack`, `tanso alerts raise`, `tanso alerts list`, `tanso alerts config`
  Verify: unit tests for each
- [ ] Wire `tanso providers list`, `tanso providers add`, `tanso link`
  Verify: manual test

## Phase 6: Distribution (single agent)
- [ ] .github/workflows/ci.yml — test on PR, npm publish on tag push
  Verify: YAML is valid, actions reference correct steps
- [ ] README.md — install, init, usage, positioning (honest about 24h latency)
  Verify: reads correctly, no BS

## Phase 7: Tests (parallel agents)
- [ ] test/providers/aws.test.ts — fixture-based, mock SDK calls
- [ ] test/providers/gcp.test.ts — fixture-based, mock BigQuery
- [ ] test/providers/azure.test.ts — fixture-based, mock fetch
- [ ] test/providers/openai.test.ts — fixture-based, mock fetch
- [ ] test/providers/anthropic.test.ts — fixture-based, mock fetch
- [ ] test/alerts/engine.test.ts — escalation, ack, expire, raise, quiet hours
- [ ] test/alerts/slack.test.ts — payload shape, formatting
- [ ] test/e2e/full-cycle.test.ts — init config → watch --once → alert fires → ack → re-check
- [ ] test/e2e/degraded-provider.test.ts — one provider fails preflight, others continue
- [ ] test/e2e/threshold-raise.test.ts — alert → raise threshold → no more alerts
  Verify: `bun test` all pass

## Phase 8: Preflight + Polish
- [ ] Preflight credential validation in watch --once (lightweight auth check per provider)
  Verify: unit test — healthy vs degraded reporting
- [ ] Final CLI polish — help text, error messages, chalk formatting
  Verify: `tanso --help`, `tanso status --help` all read cleanly
