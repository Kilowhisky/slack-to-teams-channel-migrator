import { vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import Bottleneck from "bottleneck";
import type { MigratorOptions } from "../../src/migrator";

// ── Graph API call recording ────────────────────────────────────────

export interface GraphCall {
  path: string;
  method: "GET" | "POST" | "PUT";
  body?: unknown;
}

export type GraphHandler = (
  path: string,
  method: string,
  body?: unknown
) => unknown;

/**
 * Build a mock Microsoft Graph client with fluent API support.
 * Routes .api(path).get()/.post()/.putStream() through the handler function.
 * All calls are recorded in the `calls` array for test assertions.
 */
export function buildMockGraph(handler: GraphHandler, calls: GraphCall[]) {
  return {
    api: vi.fn((apiPath: string) => {
      const builder = {
        get: vi.fn(async () => {
          calls.push({ path: apiPath, method: "GET" });
          return handler(apiPath, "GET");
        }),
        post: vi.fn(async (body: unknown) => {
          calls.push({ path: apiPath, method: "POST", body });
          return handler(apiPath, "POST", body);
        }),
        putStream: vi.fn(async (body: unknown) => {
          calls.push({ path: apiPath, method: "PUT", body });
          return handler(apiPath, "PUT", body);
        }),
        select: vi.fn(() => builder),
        filter: vi.fn(() => builder),
        top: vi.fn(() => builder),
        expand: vi.fn(() => builder),
      };
      return builder;
    }),
  };
}

// ── Slack WebClient mock ────────────────────────────────────────────

export interface SlackWebConfig {
  authTest: () => unknown;
  conversationsHistory: (args: unknown) => unknown;
  conversationsReplies: (args: unknown) => unknown;
  usersInfo: (args: unknown) => unknown;
}

export function buildMockSlackWeb(config: SlackWebConfig) {
  return {
    auth: {
      test: vi.fn(async () => config.authTest()),
    },
    conversations: {
      history: vi.fn(async (args: unknown) =>
        config.conversationsHistory(args)
      ),
      replies: vi.fn(async (args: unknown) =>
        config.conversationsReplies(args)
      ),
    },
    users: {
      info: vi.fn(async (args: unknown) => config.usersInfo(args)),
    },
  };
}

// ── Rate limiter ────────────────────────────────────────────────────

export function createNoopLimiter(): Bottleneck {
  return new Bottleneck({ maxConcurrent: 10, minTime: 0 });
}

// ── Default test options ────────────────────────────────────────────

export function makeTestOptions(
  tmpDir: string,
  overrides: Partial<MigratorOptions> = {}
): MigratorOptions {
  return {
    slackToken: "xoxb-test-token",
    slackChannel: "C01TEST",
    teamsTeamId: "team-guid-001",
    teamsChannelId: "19:channel@thread.tacv2",
    teamsTenantId: "tenant-guid",
    teamsClientId: "client-guid",
    teamsClientSecret: "client-secret",
    stateFile: path.join(tmpDir, "test-state.json"),
    dryRun: false,
    concurrency: 1,
    ...overrides,
  };
}

// ── Temp directory management ───────────────────────────────────────

export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "migration-integration-"));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
