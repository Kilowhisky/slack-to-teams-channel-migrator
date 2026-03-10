import * as fs from "fs/promises";
import type { MigrationState } from "../state/types";

export interface StatusOptions {
  stateFile: string;
  json?: boolean;
}

interface StatusOutput {
  status: string;
  source: { slackChannel: string };
  target: { teamsTeamId: string; teamsChannelId: string };
  progress: {
    messages: number;
    messagesTotal: number;
    replies: number;
    repliesTotal: number;
    filesUploaded: number;
    failed: number;
  };
  migrationMode: { active: boolean };
  timestamps: { started: string; lastUpdated: string };
  dateRange?: { oldest?: string; latest?: string };
  errors: Array<{ slackTs: string; error: string; retryable: boolean }>;
  stateFile: {
    path: string;
    messageRecords: number;
    replyRecords: number;
    fileRecords: number;
  };
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

function buildOutput(state: MigrationState, stateFilePath: string): StatusOutput {
  const s = state.stats;

  const output: StatusOutput = {
    status: state.status,
    source: { slackChannel: state.config.slackChannel },
    target: {
      teamsTeamId: state.config.teamsTeamId,
      teamsChannelId: state.config.teamsChannelId,
    },
    progress: {
      messages: s.migratedMessages + s.skippedMessages,
      messagesTotal: s.totalSlackMessages,
      replies: s.migratedReplies + s.skippedReplies,
      repliesTotal: s.totalSlackReplies,
      filesUploaded: s.filesUploaded,
      failed: s.failedMessages,
    },
    migrationMode: { active: state.migrationModeActive },
    timestamps: {
      started: s.startedAt,
      lastUpdated: s.lastUpdatedAt,
    },
    errors: state.errors.map((e) => ({
      slackTs: e.slackTs,
      error: e.error,
      retryable: e.retryable,
    })),
    stateFile: {
      path: stateFilePath,
      messageRecords: Object.keys(state.messages).length,
      replyRecords: Object.keys(state.replies).length,
      fileRecords: Object.keys(state.files).length,
    },
  };

  if (state.config.oldest || state.config.latest) {
    output.dateRange = {};
    if (state.config.oldest) output.dateRange.oldest = state.config.oldest;
    if (state.config.latest) output.dateRange.latest = state.config.latest;
  }

  return output;
}

function renderText(output: StatusOutput): void {
  const statusLabel =
    output.status === "completed"
      ? "\u2713 completed"
      : output.status === "failed"
        ? "\u2717 failed"
        : "... in progress";

  console.log(`\nMigration Status: ${statusLabel}`);
  console.log(`Source: Slack channel ${output.source.slackChannel}`);
  console.log(
    `Target: Teams ${output.target.teamsTeamId} / ${output.target.teamsChannelId}`
  );

  console.log(`\nProgress:`);
  console.log(
    `  Messages:  ${output.progress.messages} / ${output.progress.messagesTotal}  (${pct(output.progress.messages, output.progress.messagesTotal)})`
  );
  console.log(
    `  Replies:   ${output.progress.replies} / ${output.progress.repliesTotal}  (${pct(output.progress.replies, output.progress.repliesTotal)})`
  );
  console.log(`  Files:     ${output.progress.filesUploaded} uploaded`);
  console.log(`  Failed:    ${output.progress.failed}`);

  if (output.migrationMode.active) {
    console.log(`\nMigration mode: ACTIVE (channel is locked)`);
    console.log(`  Use "slack-to-teams unlock-channel" to force-unlock if needed.`);
  } else {
    console.log(`\nMigration mode: inactive`);
  }

  console.log(`\nStarted:     ${formatDate(output.timestamps.started)}`);
  console.log(`Last update: ${formatDate(output.timestamps.lastUpdated)}`);

  if (output.dateRange) {
    console.log(`\nDate range:`);
    if (output.dateRange.oldest) console.log(`  Oldest: ${output.dateRange.oldest}`);
    if (output.dateRange.latest) console.log(`  Latest: ${output.dateRange.latest}`);
  }

  if (output.errors.length > 0) {
    console.log(`\nErrors (${output.errors.length}):`);
    const shown = output.errors.slice(0, 20);
    for (const err of shown) {
      const retryable = err.retryable ? "retryable" : "permanent";
      console.log(`  ${err.slackTs}: ${err.error} (${retryable})`);
    }
    if (output.errors.length > 20) {
      console.log(`  ... and ${output.errors.length - 20} more`);
    }

    const retryableCount = output.errors.filter((e) => e.retryable).length;
    if (retryableCount > 0) {
      console.log(`\n  ${retryableCount} retryable errors. Re-run migration to retry.`);
    }
  }

  console.log(`\nState file: ${output.stateFile.path}`);
  console.log(
    `  ${output.stateFile.messageRecords} message records, ${output.stateFile.replyRecords} reply records, ${output.stateFile.fileRecords} file records`
  );
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

  const output = buildOutput(state, options.stateFile);

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    renderText(output);
  }
}
