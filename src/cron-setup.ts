import { execSync } from "node:child_process";

const CRON_MARKER = "# tanso-watch";

function getTansoCommand(): string {
  return process.argv[1] ?? "tanso";
}

export interface CronStatus {
  installed: boolean;
  entry?: string;
}

export function getCronStatus(): CronStatus {
  try {
    const crontab = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
    const line = crontab.split("\n").find((l) => l.includes(CRON_MARKER));
    if (line) {
      return { installed: true, entry: line };
    }
  } catch {
    // no crontab
  }
  return { installed: false };
}

export function writeCronEntry(intervalMinutes: number = 60): void {
  const cmd = getTansoCommand();
  const cronExpr =
    intervalMinutes === 60 ? "0 * * * *" : `*/${intervalMinutes} * * * *`;
  const newLine = `${cronExpr} ${cmd} watch --once >> ~/.tanso/tanso-watch.log 2>&1 ${CRON_MARKER}`;

  let existing = "";
  try {
    existing = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  } catch {
    // empty crontab
  }

  const filtered = existing
    .split("\n")
    .filter((l) => !l.includes(CRON_MARKER))
    .join("\n");

  const updated = filtered.trimEnd() + "\n" + newLine + "\n";
  execSync(`echo '${updated.replace(/'/g, "'\\''")}' | crontab -`);
}

export function removeCronEntry(): void {
  let existing = "";
  try {
    existing = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  } catch {
    return;
  }

  const filtered = existing
    .split("\n")
    .filter((l) => !l.includes(CRON_MARKER))
    .join("\n");

  execSync(`echo '${filtered.replace(/'/g, "'\\''")}' | crontab -`);
}
