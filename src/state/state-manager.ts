import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "../utils/logger";
import type {
  MigrationConfig,
  MigrationState,
  MigrationStats,
  FileRecord,
} from "./types";

export class StateManager {
  private state!: MigrationState;
  private filePath: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pendingOps = 0;
  private readonly FLUSH_EVERY_N_OPS = 10;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async load(config: MigrationConfig): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      this.state = JSON.parse(data) as MigrationState;

      if (this.state.version !== 1) {
        throw new Error(`Unsupported state file version: ${this.state.version}`);
      }

      this.validateConfig(config);
      logger.info(`Loaded existing state file: ${this.filePath}`);
      logger.info(
        `  Previously migrated: ${this.state.stats.migratedMessages} messages, ${this.state.stats.migratedReplies} replies`
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.state = this.createEmptyState(config);
        this.dirty = true; // Ensure initial state is written on first flush/close
        logger.info(`Created new state file: ${this.filePath}`);
      } else {
        throw err;
      }
    }
  }

  private validateConfig(config: MigrationConfig): void {
    const s = this.state.config;
    if (s.slackChannel !== config.slackChannel) {
      throw new Error(
        `State file slack channel (${s.slackChannel}) doesn't match CLI arg (${config.slackChannel}). ` +
          `Use a different --state-file or delete the existing one.`
      );
    }
    if (s.teamsTeamId !== config.teamsTeamId || s.teamsChannelId !== config.teamsChannelId) {
      throw new Error(
        `State file Teams channel doesn't match CLI args. ` +
          `Use a different --state-file or delete the existing one.`
      );
    }
  }

  private createEmptyState(config: MigrationConfig): MigrationState {
    return {
      version: 1,
      config,
      status: "in_progress",
      migrationModeActive: false,
      messages: {},
      replies: {},
      files: {},
      errors: [],
      stats: {
        totalSlackMessages: 0,
        totalSlackReplies: 0,
        migratedMessages: 0,
        migratedReplies: 0,
        skippedMessages: 0,
        skippedReplies: 0,
        failedMessages: 0,
        filesUploaded: 0,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      },
    };
  }

  isMessageMigrated(slackTs: string): boolean {
    return slackTs in this.state.messages;
  }

  isReplyMigrated(parentSlackTs: string, replySlackTs: string): boolean {
    const key = `${parentSlackTs}:${replySlackTs}`;
    return key in this.state.replies;
  }

  isFileMigrated(slackFileId: string): FileRecord | undefined {
    return this.state.files[slackFileId];
  }

  getTeamsMessageId(slackTs: string): string | undefined {
    return this.state.messages[slackTs]?.teamsMessageId;
  }

  isMigrationModeActive(): boolean {
    return this.state.migrationModeActive;
  }

  setMigrationModeActive(active: boolean): void {
    this.state.migrationModeActive = active;
    this.markDirty();
  }

  recordMessage(slackTs: string, teamsMessageId: string, isThreadParent: boolean): void {
    this.state.messages[slackTs] = {
      teamsMessageId,
      isThreadParent,
      migratedAt: new Date().toISOString(),
    };
    this.state.stats.migratedMessages++;
    this.markDirty();
  }

  recordReply(
    parentSlackTs: string,
    replySlackTs: string,
    teamsReplyId: string,
    parentTeamsMessageId: string
  ): void {
    const key = `${parentSlackTs}:${replySlackTs}`;
    this.state.replies[key] = {
      teamsReplyId,
      parentTeamsMessageId,
      migratedAt: new Date().toISOString(),
    };
    this.state.stats.migratedReplies++;
    this.markDirty();
  }

  recordFile(slackFileId: string, sharePointUrl: string, sharePointItemId: string): void {
    this.state.files[slackFileId] = {
      sharePointUrl,
      sharePointItemId,
      migratedAt: new Date().toISOString(),
    };
    this.state.stats.filesUploaded++;
    this.markDirty();
  }

  recordError(slackTs: string, error: string, retryable: boolean): void {
    this.state.errors.push({
      slackTs,
      error,
      timestamp: new Date().toISOString(),
      retryable,
    });
    this.state.stats.failedMessages++;
    this.markDirty();
  }

  recordSkippedMessage(): void {
    this.state.stats.skippedMessages++;
  }

  recordSkippedReply(): void {
    this.state.stats.skippedReplies++;
  }

  updateTotals(totalMessages: number, totalReplies: number): void {
    this.state.stats.totalSlackMessages = totalMessages;
    this.state.stats.totalSlackReplies = totalReplies;
    this.markDirty();
  }

  setStatus(status: MigrationState["status"]): void {
    this.state.status = status;
    this.markDirty();
  }

  getStats(): MigrationStats {
    return { ...this.state.stats };
  }

  getErrors() {
    return [...this.state.errors];
  }

  private markDirty(): void {
    this.dirty = true;
    this.state.stats.lastUpdatedAt = new Date().toISOString();
    this.pendingOps++;
    if (this.pendingOps >= this.FLUSH_EVERY_N_OPS) {
      this.flush().catch((err) => logger.error("Failed to flush state", err));
    }
  }

  startPeriodicFlush(intervalMs = 5000): void {
    this.flushTimer = setInterval(() => {
      if (this.dirty) {
        this.flush().catch((err) => logger.error("Failed periodic flush", err));
      }
    }, intervalMs);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
    await fs.rename(tmpPath, this.filePath);

    this.dirty = false;
    this.pendingOps = 0;
    logger.debug("State file flushed to disk");
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
