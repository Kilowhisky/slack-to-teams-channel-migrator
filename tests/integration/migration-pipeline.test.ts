import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { SlackClient } from "../../src/slack/client";
import { TeamsClient } from "../../src/teams/client";
import { downloadSlackFile } from "../../src/slack/files";
import { runMigration } from "../../src/migrator";
import type { MigrationState } from "../../src/state/types";
import {
  createNoopLimiter,
  buildMockGraph,
  buildMockSlackWeb,
  makeTestOptions,
  createTempDir,
  cleanupTempDir,
  type GraphCall,
  type GraphHandler,
} from "./helpers";
import {
  makeRawSlackMessage,
  makeRawSlackFile,
  makeSlackHistoryResponse,
  makeSlackRepliesResponse,
  makeSlackUserResponse,
} from "./fixtures";

// ── Module mocks (hoisted by Vitest) ────────────────────────────────

vi.mock("../../src/slack/client", () => ({
  SlackClient: vi.fn(),
}));

vi.mock("../../src/teams/client", () => ({
  TeamsClient: vi.fn(),
}));

vi.mock("../../src/slack/files", () => ({
  downloadSlackFile: vi.fn(),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/utils/progress", () => ({
  Progress: vi.fn().mockImplementation(() => ({
    increment: vi.fn(),
    done: vi.fn(),
  })),
}));

// Prevent MaxListenersExceeded warnings from SIGINT/SIGTERM handlers
process.setMaxListeners(0);

// ── Test suite ──────────────────────────────────────────────────────

describe("runMigration - integration", () => {
  let tmpDir: string;
  let graphCalls: GraphCall[];

  const TEAM_ID = "team-guid-001";
  const CHANNEL_ID = "19:channel@thread.tacv2";

  // ── Shared test messages ────────────────────────────────────────

  const plainMessage = makeRawSlackMessage({
    ts: "1705432800.000100",
    user: "U001",
    text: "Hello everyone!",
  });

  const messageWithFile = makeRawSlackMessage({
    ts: "1705432800.000200",
    user: "U002",
    text: "Here is the spec",
    files: [makeRawSlackFile({ id: "F001", name: "spec.pdf" })],
  });

  const threadParent = makeRawSlackMessage({
    ts: "1705432800.000300",
    user: "U001",
    text: "Let's discuss the roadmap",
    reply_count: 2,
    thread_ts: "1705432800.000300",
  });

  const reply1 = makeRawSlackMessage({
    ts: "1705432800.000301",
    user: "U002",
    text: "Focus on API first",
    thread_ts: "1705432800.000300",
  });

  const reply2 = makeRawSlackMessage({
    ts: "1705432800.000302",
    user: "U001",
    text: "Agreed",
    thread_ts: "1705432800.000300",
  });

  // ── Mock setup helper ───────────────────────────────────────────

  function setupMocks(overrides?: {
    graphHandler?: GraphHandler;
    conversationsHistory?: (args: unknown) => unknown;
    conversationsReplies?: (args: unknown) => unknown;
    usersInfo?: (args: unknown) => unknown;
  }) {
    let msgCounter = 0;

    const defaultGraphHandler: GraphHandler = (apiPath, method) => {
      if (apiPath === "/organization") return { value: [] };
      if (apiPath === `/teams/${TEAM_ID}/channels/${CHANNEL_ID}`) {
        return { displayName: "Test Channel", membershipType: "standard" };
      }
      if (
        apiPath.includes("/startMigration") ||
        apiPath.includes("/completeMigration")
      ) {
        return {};
      }
      if (apiPath.endsWith("/messages") && method === "POST") {
        return { id: `teams-msg-${++msgCounter}` };
      }
      if (apiPath.includes("/replies") && method === "POST") {
        return { id: `teams-reply-${++msgCounter}` };
      }
      if (apiPath.endsWith("/filesFolder")) {
        return { id: "folder-001", parentReference: { driveId: "drive-001" } };
      }
      if (apiPath.includes(":/content") && method === "PUT") {
        const match = apiPath.match(/:\/(.+):\/content/);
        const fileName = match?.[1] || "unknown";
        return {
          id: "sp-file-001",
          name: fileName,
          webUrl: `https://sp.com/${fileName}`,
        };
      }
      throw new Error(`Unhandled Graph API call: ${method} ${apiPath}`);
    };

    const graphHandler = overrides?.graphHandler ?? defaultGraphHandler;
    const mockGraph = buildMockGraph(graphHandler, graphCalls);
    const noopLimiter = createNoopLimiter();

    // Slack API responses
    const defaultHistory = () =>
      makeSlackHistoryResponse([plainMessage, messageWithFile, threadParent]);

    const defaultReplies = (args: unknown) => {
      const { ts } = args as { ts: string };
      if (ts === threadParent.ts) {
        // Include parent echo (Slack API returns parent as first message)
        return makeSlackRepliesResponse([threadParent, reply1, reply2]);
      }
      return makeSlackRepliesResponse([]);
    };

    const defaultUsersInfo = (args: unknown) => {
      const { user } = args as { user: string };
      if (user === "U001") return makeSlackUserResponse("U001", "Alice");
      if (user === "U002") return makeSlackUserResponse("U002", "Bob");
      return makeSlackUserResponse(user, user);
    };

    const mockSlackWeb = buildMockSlackWeb({
      authTest: () => ({ ok: true, team: "Test Workspace" }),
      conversationsHistory:
        overrides?.conversationsHistory ?? defaultHistory,
      conversationsReplies:
        overrides?.conversationsReplies ?? defaultReplies,
      usersInfo: overrides?.usersInfo ?? defaultUsersInfo,
    });

    // Wire up mock constructors
    vi.mocked(SlackClient).mockImplementation(
      () =>
        ({
          web: mockSlackWeb,
          limiter: noopLimiter,
          testAuth: vi.fn().mockResolvedValue("Test Workspace"),
        }) as unknown as SlackClient
    );

    vi.mocked(TeamsClient).mockImplementation(
      () =>
        ({
          graph: mockGraph,
          limiter: noopLimiter,
          testConnection: vi.fn().mockResolvedValue(undefined),
        }) as unknown as TeamsClient
    );

    // Mock file download — write a temp file and return its path
    vi.mocked(downloadSlackFile).mockImplementation(async (file) => {
      const filePath = path.join(tmpDir, `${file.id}_${file.name}`);
      await fs.writeFile(filePath, "mock file content");
      return filePath;
    });

    return { mockSlackWeb, mockGraph };
  }

  // ── Setup / teardown ────────────────────────────────────────────

  beforeEach(async () => {
    tmpDir = await createTempDir();
    graphCalls = [];
    process.exitCode = undefined;
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  async function readState(stateFile: string): Promise<MigrationState> {
    const data = await fs.readFile(stateFile, "utf-8");
    return JSON.parse(data) as MigrationState;
  }

  // ── Happy path ──────────────────────────────────────────────────

  describe("happy path", () => {
    it("migrates messages, files, and thread replies end-to-end", async () => {
      setupMocks();
      const options = makeTestOptions(tmpDir);

      await runMigration(options);

      // Verify state file
      const state = await readState(options.stateFile);
      expect(state.status).toBe("completed");
      expect(state.stats.migratedMessages).toBe(3);
      expect(state.stats.migratedReplies).toBe(2);
      expect(state.stats.filesUploaded).toBe(1);
      expect(state.stats.failedMessages).toBe(0);
      expect(state.migrationModeActive).toBe(false);
      expect(state.errors).toHaveLength(0);

      // Verify migration lifecycle order
      const startCalls = graphCalls.filter((c) =>
        c.path.includes("/startMigration")
      );
      const completeCalls = graphCalls.filter((c) =>
        c.path.includes("/completeMigration")
      );
      expect(startCalls).toHaveLength(1);
      expect(completeCalls).toHaveLength(1);

      const startIdx = graphCalls.indexOf(startCalls[0]);
      const firstMsgIdx = graphCalls.findIndex(
        (c) => c.path.endsWith("/messages") && c.method === "POST"
      );
      expect(startIdx).toBeLessThan(firstMsgIdx);

      // Verify 3 message posts with HTML bodies
      const messagePosts = graphCalls.filter(
        (c) => c.path.endsWith("/messages") && c.method === "POST"
      );
      expect(messagePosts).toHaveLength(3);
      for (const post of messagePosts) {
        const body = post.body as {
          body: { contentType: string; content: string };
        };
        expect(body.body.contentType).toBe("html");
        expect(body.body.content).toBeTruthy();
      }

      // Verify 2 reply posts under correct parent (teams-msg-3)
      const replyPosts = graphCalls.filter(
        (c) => c.path.includes("/replies") && c.method === "POST"
      );
      expect(replyPosts).toHaveLength(2);
      for (const reply of replyPosts) {
        expect(reply.path).toContain("teams-msg-3");
      }

      // Verify file was downloaded and uploaded
      expect(downloadSlackFile).toHaveBeenCalledOnce();
      const uploadCalls = graphCalls.filter(
        (c) => c.path.includes(":/content") && c.method === "PUT"
      );
      expect(uploadCalls).toHaveLength(1);
    });

    it("resolves user display names in Teams payloads", async () => {
      const { mockSlackWeb } = setupMocks();
      const options = makeTestOptions(tmpDir);

      await runMigration(options);

      // users.info called for both unique users
      expect(mockSlackWeb.users.info).toHaveBeenCalledTimes(2);

      // Verify display names in message payloads
      const messagePosts = graphCalls.filter(
        (c) => c.path.endsWith("/messages") && c.method === "POST"
      );

      const firstPayload = messagePosts[0].body as {
        from: { user: { displayName: string } };
      };
      expect(firstPayload.from.user.displayName).toBe("Alice"); // U001

      const secondPayload = messagePosts[1].body as {
        from: { user: { displayName: string } };
      };
      expect(secondPayload.from.user.displayName).toBe("Bob"); // U002
    });
  });

  // ── Dry run ─────────────────────────────────────────────────────

  describe("dry run", () => {
    it("does not call any Teams posting APIs", async () => {
      setupMocks();
      const options = makeTestOptions(tmpDir, { dryRun: true });

      await runMigration(options);

      // No POST or PUT calls to Graph
      const postCalls = graphCalls.filter((c) => c.method === "POST");
      expect(postCalls).toHaveLength(0);

      const putCalls = graphCalls.filter((c) => c.method === "PUT");
      expect(putCalls).toHaveLength(0);

      // No file downloads
      expect(downloadSlackFile).not.toHaveBeenCalled();

      // Slack client was still created (messages were fetched)
      expect(SlackClient).toHaveBeenCalledOnce();
    });
  });

  // ── Resumability ────────────────────────────────────────────────

  describe("resumability", () => {
    it("skips already-migrated messages and does not re-start migration", async () => {
      const options = makeTestOptions(tmpDir);

      // Pre-seed state file with 2 messages already migrated
      const existingState: MigrationState = {
        version: 1,
        config: {
          slackChannel: options.slackChannel,
          teamsTeamId: options.teamsTeamId,
          teamsChannelId: options.teamsChannelId,
        },
        status: "in_progress",
        migrationModeActive: true,
        messages: {
          "1705432800.000100": {
            teamsMessageId: "existing-msg-1",
            isThreadParent: false,
            migratedAt: new Date().toISOString(),
          },
          "1705432800.000200": {
            teamsMessageId: "existing-msg-2",
            isThreadParent: false,
            migratedAt: new Date().toISOString(),
          },
        },
        replies: {},
        files: {
          F001: {
            sharePointUrl: "https://sp.com/spec.pdf",
            sharePointItemId: "sp-existing-001",
            migratedAt: new Date().toISOString(),
          },
        },
        errors: [],
        stats: {
          totalSlackMessages: 3,
          totalSlackReplies: 2,
          migratedMessages: 2,
          migratedReplies: 0,
          skippedMessages: 0,
          skippedReplies: 0,
          failedMessages: 0,
          filesUploaded: 1,
          startedAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        },
      };
      await fs.writeFile(
        options.stateFile,
        JSON.stringify(existingState, null, 2)
      );

      setupMocks();
      await runMigration(options);

      // Only 1 new message post (the thread parent)
      const messagePosts = graphCalls.filter(
        (c) => c.path.endsWith("/messages") && c.method === "POST"
      );
      expect(messagePosts).toHaveLength(1);

      // startMigration NOT called (already active in state)
      const startCalls = graphCalls.filter((c) =>
        c.path.includes("/startMigration")
      );
      expect(startCalls).toHaveLength(0);

      // File NOT re-downloaded (already in state)
      expect(downloadSlackFile).not.toHaveBeenCalled();

      // Correct stats
      const state = await readState(options.stateFile);
      expect(state.stats.skippedMessages).toBe(2);
      expect(state.stats.migratedMessages).toBe(3); // 2 existing + 1 new
      expect(state.stats.migratedReplies).toBe(2);
      expect(state.status).toBe("completed");
    });
  });

  // ── Error handling ──────────────────────────────────────────────

  describe("error handling", () => {
    it("continues after a single message post failure", async () => {
      let msgCounter = 0;
      const failingGraphHandler: GraphHandler = (apiPath, method) => {
        if (apiPath === "/organization") return { value: [] };
        if (apiPath === `/teams/${TEAM_ID}/channels/${CHANNEL_ID}`) {
          return { displayName: "Test Channel", membershipType: "standard" };
        }
        if (
          apiPath.includes("/startMigration") ||
          apiPath.includes("/completeMigration")
        ) {
          return {};
        }
        if (apiPath.endsWith("/messages") && method === "POST") {
          msgCounter++;
          if (msgCounter === 2) {
            throw new Error("Simulated post failure");
          }
          return { id: `teams-msg-${msgCounter}` };
        }
        if (apiPath.includes("/replies") && method === "POST") {
          return { id: `teams-reply-${++msgCounter}` };
        }
        if (apiPath.endsWith("/filesFolder")) {
          return {
            id: "folder-001",
            parentReference: { driveId: "drive-001" },
          };
        }
        if (apiPath.includes(":/content") && method === "PUT") {
          return {
            id: "sp-file-001",
            name: "spec.pdf",
            webUrl: "https://sp.com/spec.pdf",
          };
        }
        throw new Error(`Unhandled: ${method} ${apiPath}`);
      };

      setupMocks({ graphHandler: failingGraphHandler });
      const options = makeTestOptions(tmpDir);

      await runMigration(options);

      const state = await readState(options.stateFile);
      expect(state.stats.migratedMessages).toBe(2);
      expect(state.stats.failedMessages).toBe(1);
      expect(state.stats.migratedReplies).toBe(2);
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].error).toContain("Simulated post failure");
      expect(process.exitCode).toBe(1);
    });

    it("skips thread replies when parent message failed to post", async () => {
      const failingParent = makeRawSlackMessage({
        ts: "1705432800.000300",
        user: "U001",
        text: "This will fail",
        reply_count: 2,
        thread_ts: "1705432800.000300",
      });

      const failingGraphHandler: GraphHandler = (apiPath, method) => {
        if (apiPath === "/organization") return { value: [] };
        if (apiPath === `/teams/${TEAM_ID}/channels/${CHANNEL_ID}`) {
          return { displayName: "Test Channel", membershipType: "standard" };
        }
        if (
          apiPath.includes("/startMigration") ||
          apiPath.includes("/completeMigration")
        ) {
          return {};
        }
        if (apiPath.endsWith("/messages") && method === "POST") {
          throw new Error("Parent post failed");
        }
        if (apiPath.includes("/replies") && method === "POST") {
          return { id: "teams-reply-1" };
        }
        if (apiPath.endsWith("/filesFolder")) {
          return {
            id: "folder-001",
            parentReference: { driveId: "drive-001" },
          };
        }
        throw new Error(`Unhandled: ${method} ${apiPath}`);
      };

      setupMocks({
        graphHandler: failingGraphHandler,
        conversationsHistory: () =>
          makeSlackHistoryResponse([failingParent]),
        conversationsReplies: (args: unknown) => {
          const { ts } = args as { ts: string };
          if (ts === failingParent.ts) {
            return makeSlackRepliesResponse([failingParent, reply1, reply2]);
          }
          return makeSlackRepliesResponse([]);
        },
      });

      const options = makeTestOptions(tmpDir);
      await runMigration(options);

      // No reply posts (parent failed, so all replies are skipped)
      const replyPosts = graphCalls.filter(
        (c) => c.path.includes("/replies") && c.method === "POST"
      );
      expect(replyPosts).toHaveLength(0);

      const state = await readState(options.stateFile);
      expect(state.stats.failedMessages).toBe(1);
      expect(state.stats.migratedReplies).toBe(0);
      expect(process.exitCode).toBe(1);
    });
  });

  // ── Date range filtering ────────────────────────────────────────

  describe("date range filtering", () => {
    it("passes oldest and latest as Unix timestamps to Slack API", async () => {
      const { mockSlackWeb } = setupMocks();
      const options = makeTestOptions(tmpDir, {
        oldest: "2024-01-15T00:00:00Z",
        latest: "2024-01-16T00:00:00Z",
      });

      await runMigration(options);

      expect(mockSlackWeb.conversations.history).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C01TEST",
          oldest: String(
            new Date("2024-01-15T00:00:00Z").getTime() / 1000
          ),
          latest: String(
            new Date("2024-01-16T00:00:00Z").getTime() / 1000
          ),
        })
      );
    });
  });
});
