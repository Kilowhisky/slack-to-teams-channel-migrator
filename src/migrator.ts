import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SlackClient } from "./slack/client";
import { SlackUserResolver } from "./slack/users";
import { buildThreadedChannel } from "./slack/messages";
import { downloadSlackFile } from "./slack/files";
import { TeamsClient } from "./teams/client";
import { startMigration, completeMigration, getChannelInfo } from "./teams/migration-mode";
import { postMigrationMessage, postMigrationReply } from "./teams/poster";
import { uploadFileToChannel } from "./teams/files";
import {
  formatMessageForMigration,
  type UserMapping,
} from "./transform/message-formatter";
import { StateManager } from "./state/state-manager";
import { logger } from "./utils/logger";
import { Progress } from "./utils/progress";
import type {
  NormalizedSlackMessage,
  MigrationConfig,
  SlackFile,
} from "./state/types";

export interface MigratorOptions {
  slackToken: string;
  slackChannel: string;
  teamsTeamId: string;
  teamsChannelId: string;
  teamsTenantId: string;
  teamsClientId: string;
  teamsClientSecret: string;
  oldest?: string;
  latest?: string;
  stateFile: string;
  userMapFile?: string;
  dryRun: boolean;
  concurrency?: number;
}

function parseTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;

  // If it's already a Unix timestamp
  if (/^\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  // Try ISO 8601 parsing
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}. Use ISO 8601 format or Unix timestamp.`);
  }
  return String(date.getTime() / 1000);
}

async function loadUserMap(filePath?: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!filePath) return map;

  try {
    const data = await fs.readFile(filePath, "utf-8");
    const json = JSON.parse(data) as Record<string, string>;
    for (const [slackId, aadId] of Object.entries(json)) {
      map.set(slackId, aadId);
    }
    logger.info(`Loaded user mapping: ${map.size} users`);
  } catch (err) {
    logger.warn(`Failed to load user map file: ${err}`);
  }
  return map;
}

async function uploadMessageFiles(
  msg: NormalizedSlackMessage,
  slackToken: string,
  teamsClient: TeamsClient,
  teamId: string,
  channelId: string,
  stateManager: StateManager,
  dryRun: boolean
): Promise<Map<string, { url: string; name: string }>> {
  const uploadedFiles = new Map<string, { url: string; name: string }>();

  if (!msg.files || msg.files.length === 0) return uploadedFiles;

  const tmpDir = path.join(os.tmpdir(), "slack-teams-migration-files");

  for (const file of msg.files) {
    // Check if already uploaded
    const existing = stateManager.isFileMigrated(file.id);
    if (existing) {
      uploadedFiles.set(file.id, { url: existing.sharePointUrl, name: file.name });
      continue;
    }

    if (dryRun) {
      logger.info(`  [DRY RUN] Would upload file: ${file.name}`);
      continue;
    }

    try {
      // Download from Slack
      const localPath = await downloadSlackFile(file, slackToken, tmpDir);

      // Upload to Teams
      const uploaded = await uploadFileToChannel(
        teamsClient,
        teamId,
        channelId,
        localPath,
        file.name
      );

      stateManager.recordFile(file.id, uploaded.webUrl, uploaded.id);
      uploadedFiles.set(file.id, { url: uploaded.webUrl, name: uploaded.name });

      logger.debug(`  Uploaded file: ${file.name} -> ${uploaded.webUrl}`);
    } catch (err) {
      logger.warn(`  Failed to upload file ${file.name}: ${err}`);
      // Continue without the file attachment
    }
  }

  return uploadedFiles;
}

export async function runMigration(options: MigratorOptions): Promise<void> {
  // Phase 1: Initialize
  logger.info("=== Phase 1: Initializing ===");

  const slackClient = new SlackClient({ token: options.slackToken });
  const concurrency = Math.min(Math.max(options.concurrency ?? 1, 1), 5);
  const teamsClient = new TeamsClient({
    tenantId: options.teamsTenantId,
    clientId: options.teamsClientId,
    clientSecret: options.teamsClientSecret,
    concurrency,
  });

  // Test connections
  const slackTeam = await slackClient.testAuth();
  logger.info(`Connected to Slack workspace: ${slackTeam}`);

  await teamsClient.testConnection();
  const channelInfo = await getChannelInfo(
    teamsClient,
    options.teamsTeamId,
    options.teamsChannelId
  );
  logger.info(`Connected to Teams channel: ${channelInfo.displayName}`);

  // Load state
  const config: MigrationConfig = {
    slackChannel: options.slackChannel,
    teamsTeamId: options.teamsTeamId,
    teamsChannelId: options.teamsChannelId,
    oldest: options.oldest,
    latest: options.latest,
  };

  const stateManager = new StateManager(options.stateFile);
  await stateManager.load(config);
  stateManager.startPeriodicFlush();

  // Register shutdown handlers
  const shutdown = async () => {
    logger.info("\nShutting down gracefully...");
    await stateManager.close();
    if (stateManager.isMigrationModeActive()) {
      logger.warn(
        "WARNING: Teams channel is still in migration mode (locked). " +
          "Re-run this tool to continue, or manually call completeMigration."
      );
    }
    process.exit(130);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    // Phase 2: Fetch from Slack
    logger.info("\n=== Phase 2: Fetching from Slack ===");

    const oldest = parseTimestamp(options.oldest);
    const latest = parseTimestamp(options.latest);

    const threadedChannel = await buildThreadedChannel(slackClient, {
      channel: options.slackChannel,
      oldest,
      latest,
    });

    // Resolve user names
    const userIds = new Set<string>();
    for (const msg of threadedChannel.topLevelMessages) {
      userIds.add(msg.user);
    }
    for (const replies of threadedChannel.threads.values()) {
      for (const reply of replies) {
        userIds.add(reply.user);
      }
    }

    const userResolver = new SlackUserResolver(slackClient);
    const displayNames = await userResolver.resolveAll([...userIds]);
    const aadIds = await loadUserMap(options.userMapFile);

    const userMapping: UserMapping = { aadIds, displayNames };

    const totalReplies = [...threadedChannel.threads.values()].reduce(
      (sum, r) => sum + r.length,
      0
    );
    stateManager.updateTotals(
      threadedChannel.topLevelMessages.length,
      totalReplies
    );

    // Phase 3: Transform (happens inline during posting)
    logger.info("\n=== Phase 3: Transforming & Posting ===");

    if (options.dryRun) {
      logger.info("[DRY RUN] Would post the following messages:");
      for (const msg of threadedChannel.topLevelMessages) {
        const payload = formatMessageForMigration(msg, { userMapping });
        const name = displayNames.get(msg.user) ?? msg.user;
        logger.info(
          `  [${payload.createdDateTime}] ${name}: ${msg.text.substring(0, 80)}...`
        );
        const replies = threadedChannel.threads.get(msg.ts);
        if (replies) {
          for (const reply of replies) {
            const replyName = displayNames.get(reply.user) ?? reply.user;
            logger.info(
              `    ↳ [${new Date(parseFloat(reply.ts) * 1000).toISOString()}] ${replyName}: ${reply.text.substring(0, 60)}...`
            );
          }
        }
      }
      const stats = stateManager.getStats();
      logger.info(
        `\n[DRY RUN] Would migrate ${stats.totalSlackMessages} messages and ${stats.totalSlackReplies} replies.`
      );
      await stateManager.close();
      return;
    }

    // Phase 4: Post to Teams
    logger.info("\n=== Phase 4: Posting to Teams ===");

    // Start migration mode if not already active
    if (!stateManager.isMigrationModeActive()) {
      await startMigration(teamsClient, options.teamsTeamId, options.teamsChannelId);
      stateManager.setMigrationModeActive(true);
      await stateManager.flush();
    } else {
      logger.info("Migration mode already active (resuming from previous run)");
    }

    // Post top-level messages
    const msgProgress = new Progress(
      "Posting messages",
      threadedChannel.topLevelMessages.length
    );

    for (const msg of threadedChannel.topLevelMessages) {
      if (stateManager.isMessageMigrated(msg.ts)) {
        stateManager.recordSkippedMessage();
        msgProgress.increment();
        continue;
      }

      try {
        // Upload files for this message
        const uploadedFiles = await uploadMessageFiles(
          msg,
          options.slackToken,
          teamsClient,
          options.teamsTeamId,
          options.teamsChannelId,
          stateManager,
          false
        );

        const payload = formatMessageForMigration(msg, {
          userMapping,
          uploadedFiles,
        });

        const result = await postMigrationMessage(
          teamsClient,
          options.teamsTeamId,
          options.teamsChannelId,
          payload
        );

        stateManager.recordMessage(msg.ts, result.id, msg.isThreadParent);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to post message ${msg.ts}: ${errMsg}`);
        stateManager.recordError(msg.ts, errMsg, true);
      }

      msgProgress.increment();
    }
    msgProgress.done();

    // Post thread replies
    const threadParents = [...threadedChannel.threads.entries()];
    if (threadParents.length > 0) {
      const totalRepliesCount = threadParents.reduce(
        (sum, [, replies]) => sum + replies.length,
        0
      );
      const replyProgress = new Progress("Posting replies", totalRepliesCount);

      // Flatten all reply work items into a queue
      interface ReplyWorkItem {
        parentTs: string;
        parentTeamsId: string;
        reply: NormalizedSlackMessage;
      }

      const replyQueue: ReplyWorkItem[] = [];
      for (const [parentTs, replies] of threadParents) {
        const parentTeamsId = stateManager.getTeamsMessageId(parentTs);
        if (!parentTeamsId) {
          logger.warn(
            `Skipping thread ${parentTs}: parent message not found in Teams (may have failed)`
          );
          for (const _ of replies) replyProgress.increment();
          continue;
        }

        for (const reply of replies) {
          replyQueue.push({ parentTs, parentTeamsId, reply });
        }
      }

      // Process replies using a worker pool
      let queueIndex = 0;
      const processReply = async () => {
        while (queueIndex < replyQueue.length) {
          const idx = queueIndex++;
          const { parentTs, parentTeamsId, reply } = replyQueue[idx];

          if (stateManager.isReplyMigrated(parentTs, reply.ts)) {
            stateManager.recordSkippedReply();
            replyProgress.increment();
            continue;
          }

          try {
            const uploadedFiles = await uploadMessageFiles(
              reply,
              options.slackToken,
              teamsClient,
              options.teamsTeamId,
              options.teamsChannelId,
              stateManager,
              false
            );

            const payload = formatMessageForMigration(reply, {
              userMapping,
              uploadedFiles,
            });

            const result = await postMigrationReply(
              teamsClient,
              options.teamsTeamId,
              options.teamsChannelId,
              parentTeamsId,
              payload
            );

            stateManager.recordReply(parentTs, reply.ts, result.id, parentTeamsId);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to post reply ${reply.ts}: ${errMsg}`);
            stateManager.recordError(reply.ts, errMsg, true);
          }

          replyProgress.increment();
        }
      };

      const workers = Array.from(
        { length: Math.min(concurrency, replyQueue.length) },
        () => processReply()
      );
      await Promise.all(workers);
      replyProgress.done();
    }

    // Complete migration
    await completeMigration(teamsClient, options.teamsTeamId, options.teamsChannelId);
    stateManager.setMigrationModeActive(false);
    stateManager.setStatus("completed");

    // Phase 5: Report
    logger.info("\n=== Phase 5: Migration Summary ===");
    const stats = stateManager.getStats();
    logger.info(`  Total Slack messages:  ${stats.totalSlackMessages}`);
    logger.info(`  Total Slack replies:   ${stats.totalSlackReplies}`);
    logger.info(`  Messages migrated:     ${stats.migratedMessages}`);
    logger.info(`  Replies migrated:      ${stats.migratedReplies}`);
    logger.info(`  Messages skipped:      ${stats.skippedMessages} (already migrated)`);
    logger.info(`  Replies skipped:       ${stats.skippedReplies} (already migrated)`);
    logger.info(`  Files uploaded:        ${stats.filesUploaded}`);
    logger.info(`  Failed:                ${stats.failedMessages}`);

    const errors = stateManager.getErrors();
    if (errors.length > 0) {
      logger.warn(`\n  Failed messages:`);
      for (const err of errors.slice(0, 10)) {
        logger.warn(`    ${err.slackTs}: ${err.error}`);
      }
      if (errors.length > 10) {
        logger.warn(`    ... and ${errors.length - 10} more (see state file)`);
      }
    }

    await stateManager.close();

    if (stats.failedMessages > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    stateManager.setStatus("failed");
    await stateManager.close();
    throw err;
  }
}
