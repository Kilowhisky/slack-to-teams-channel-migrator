import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { StateManager } from "../../src/state/state-manager";
import type { MigrationConfig } from "../../src/state/types";

const config: MigrationConfig = {
  slackChannel: "C01TEST",
  teamsTeamId: "team-guid",
  teamsChannelId: "19:channel@thread.tacv2",
};

let tmpDir: string;
let stateFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-test-"));
  stateFile = path.join(tmpDir, "test-state.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("StateManager", () => {
  it("creates new state file when none exists", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);
    await sm.close();

    const data = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(data.version).toBe(1);
    expect(data.config.slackChannel).toBe("C01TEST");
    expect(data.status).toBe("in_progress");
  });

  it("loads existing state file", async () => {
    // Create initial state
    const sm1 = new StateManager(stateFile);
    await sm1.load(config);
    sm1.recordMessage("1234.5678", "teams-msg-1", false);
    await sm1.close();

    // Reload
    const sm2 = new StateManager(stateFile);
    await sm2.load(config);
    expect(sm2.isMessageMigrated("1234.5678")).toBe(true);
    expect(sm2.isMessageMigrated("9999.0000")).toBe(false);
    await sm2.close();
  });

  it("detects config mismatch", async () => {
    const sm1 = new StateManager(stateFile);
    await sm1.load(config);
    await sm1.close();

    const sm2 = new StateManager(stateFile);
    await expect(
      sm2.load({ ...config, slackChannel: "C99DIFFERENT" })
    ).rejects.toThrow("slack channel");
  });

  it("tracks message migration", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);

    expect(sm.isMessageMigrated("1234.5678")).toBe(false);
    sm.recordMessage("1234.5678", "teams-msg-1", true);
    expect(sm.isMessageMigrated("1234.5678")).toBe(true);
    expect(sm.getTeamsMessageId("1234.5678")).toBe("teams-msg-1");

    await sm.close();
  });

  it("tracks reply migration with composite key", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);

    expect(sm.isReplyMigrated("1234.5678", "1234.5679")).toBe(false);
    sm.recordReply("1234.5678", "1234.5679", "teams-reply-1", "teams-msg-1");
    expect(sm.isReplyMigrated("1234.5678", "1234.5679")).toBe(true);

    await sm.close();
  });

  it("tracks file migration", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);

    expect(sm.isFileMigrated("F001")).toBeUndefined();
    sm.recordFile("F001", "https://sharepoint.com/file.pdf", "item-id-001");
    expect(sm.isFileMigrated("F001")).toBeDefined();
    expect(sm.isFileMigrated("F001")!.sharePointUrl).toBe(
      "https://sharepoint.com/file.pdf"
    );

    await sm.close();
  });

  it("tracks errors", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);

    sm.recordError("1234.5678", "Bad request", false);
    const errors = sm.getErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].slackTs).toBe("1234.5678");
    expect(errors[0].retryable).toBe(false);

    await sm.close();
  });

  it("tracks stats correctly", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);

    sm.updateTotals(100, 50);
    sm.recordMessage("1.0", "t1", false);
    sm.recordMessage("2.0", "t2", false);
    sm.recordReply("1.0", "1.1", "tr1", "t1");
    sm.recordSkippedMessage();
    sm.recordError("3.0", "fail", true);

    const stats = sm.getStats();
    expect(stats.totalSlackMessages).toBe(100);
    expect(stats.totalSlackReplies).toBe(50);
    expect(stats.migratedMessages).toBe(2);
    expect(stats.migratedReplies).toBe(1);
    expect(stats.skippedMessages).toBe(1);
    expect(stats.failedMessages).toBe(1);

    await sm.close();
  });

  it("tracks migration mode active state", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);

    expect(sm.isMigrationModeActive()).toBe(false);
    sm.setMigrationModeActive(true);
    expect(sm.isMigrationModeActive()).toBe(true);
    await sm.close();

    // Reload and verify persistence
    const sm2 = new StateManager(stateFile);
    await sm2.load(config);
    expect(sm2.isMigrationModeActive()).toBe(true);
    await sm2.close();
  });

  it("uses atomic write with tmp file", async () => {
    const sm = new StateManager(stateFile);
    await sm.load(config);
    sm.recordMessage("1.0", "t1", false);
    await sm.flush();

    // Verify the file exists and is valid JSON
    const data = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    expect(data.messages["1.0"].teamsMessageId).toBe("t1");

    // Verify no tmp file left behind
    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);

    await sm.close();
  });
});
