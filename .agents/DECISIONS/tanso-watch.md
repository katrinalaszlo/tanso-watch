# tanso-watch Decisions

## From /plan-eng-review 2026-04-27 — ALL FINAL

1. **All 5 providers in scope.** No phasing. AWS, GCP, Azure, OpenAI, Anthropic.
2. **Permissions honesty.** Every provider needs admin access. `tanso init` generates copy-paste admin-request template. Don't promise "no permissions needed."
3. **GitHub Actions included.** Test on PR, npm publish on tag push. In scope for v1.
4. **No daemon.** Cron-based via `tanso watch --once`. No daemon.ts. `tanso init` writes the crontab entry. `tanso watch` (no flag) shows cron status.
5. **GCP billing export detection.** Check via BigQuery information_schema. Show setup guide + link if billing export not configured.
6. **Preflight validation.** Every `watch --once` validates credentials first. Reports healthy vs degraded providers. Skips degraded, continues with healthy.
7. **Positioning: cost drift, not spikes.** 24h latency is documented, not hidden. README is honest.
8. **better-sqlite3, not bun:sqlite.** Must work on Node.js, not just Bun.
9. **Full test suite.** Unit tests for all modules + 3 E2E scenarios.
10. **`tanso alerts raise` command.** Alongside `tanso ack`. Permanently adjusts threshold instead of re-acking forever.
