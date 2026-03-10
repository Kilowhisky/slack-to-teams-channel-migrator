import * as fs from "fs/promises";
import type { MigrationState } from "../state/types";

export interface StatusOptions {
  stateFile: string;
}

function pct(num: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((num / total) * 100)}%`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export async function showStatus(options: StatusOptions): Promise<void> {
  let data: string;
  try {
    data = await fs.readFile(options.stateFile, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`State file not found: ${options.stateFile}`);
    } else {
      console.error(`Failed to read state file: ${err instanceof Error ? err.message : err}`);
    }
    process.exitCode = 1;
    return;
  }

  let state: MigrationState;
  try {
    state = JSON.parse(data) as MigrationState;
  } catch {
    console.error("State file is not valid JSON.");
    process.exitCode = 1;
    return;
  }

  const s = state.stats;
  const migratedTotal = s.migratedMessages + s.skippedMessages;
  const repliesTotal = s.migratedReplies + s.skippedReplies;

  // Status header
  const statusLabel =
    state.status === "completed"
      ? "\u2713 completed"
      : state.status === "failed"
        ? "\u2717 failed"
        : "... in progress";

  console.log(`\nMigration Status: ${statusLabel}`);
  console.log(
    `Source: Slack channel ${state.config.slackChannel}`
  );
  console.log(
    `Target: Teams ${state.config.teamsTeamId} / ${state.config.teamsChannelId}`
  );

  // Progress
  console.log(`\nProgress:`);
  console.log(
    `  Messages:  ${migratedTotal} / ${s.totalSlackMessages}  (${pct(migratedTotal, s.totalSlackMessages)})`
  );
  console.log(
    `  Replies:   ${repliesTotal} / ${s.totalSlackReplies}  (${pct(repliesTotal, s.totalSlackReplies)})`
  );
  console.log(`  Files:     ${s.filesUploaded} uploaded`);
  console.log(`  Failed:    ${s.failedMessages}`);

  // Migration mode
  if (state.migrationModeActive) {
    console.log(`\nMigration mode: ACTIVE (channel is locked)`);
    console.log(`  Use "slack-to-teams unlock-channel" to force-unlock if needed.`);
  } else {
    console.log(`\nMigration mode: inactive`);
  }

  // Timestamps
  console.log(`\nStarted:     ${formatDate(s.startedAt)}`);
  console.log(`Last update: ${formatDate(s.lastUpdatedAt)}`);

  // Date range
  if (state.config.oldest || state.config.latest) {
    console.log(`\nDate range:`);
    if (state.config.oldest) console.log(`  Oldest: ${state.config.oldest}`);
    if (state.config.latest) console.log(`  Latest: ${state.config.latest}`);
  }

  // Errors
  if (state.errors.length > 0) {
    console.log(`\nErrors (${state.errors.length}):`);
    const shown = state.errors.slice(0, 20);
    for (const err of shown) {
      const retryable = err.retryable ? "retryable" : "permanent";
      console.log(`  ${err.slackTs}: ${err.error} (${retryable})`);
    }
    if (state.errors.length > 20) {
      console.log(`  ... and ${state.errors.length - 20} more`);
    }

    const retryableCount = state.errors.filter((e) => e.retryable).length;
    if (retryableCount > 0) {
      console.log(`\n  ${retryableCount} retryable errors. Re-run migration to retry.`);
    }
  }

  // File stats
  const fileCount = Object.keys(state.files).length;
  const messageCount = Object.keys(state.messages).length;
  const replyCount = Object.keys(state.replies).length;

  console.log(`\nState file: ${options.stateFile}`);
  console.log(`  ${messageCount} message records, ${replyCount} reply records, ${fileCount} file records`);
}
