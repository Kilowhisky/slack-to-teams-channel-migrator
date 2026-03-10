import * as fs from "fs/promises";
import { TeamsClient } from "../teams/client";
import { completeMigration, getChannelInfo } from "../teams/migration-mode";
import type { MigrationState } from "../state/types";

export interface UnlockChannelOptions {
  teamsTeamId: string;
  teamsChannelId: string;
  teamsTenantId: string;
  teamsClientId: string;
  teamsClientSecret: string;
  stateFile?: string;
}

export async function unlockChannel(options: UnlockChannelOptions): Promise<void> {
  const client = new TeamsClient({
    tenantId: options.teamsTenantId,
    clientId: options.teamsClientId,
    clientSecret: options.teamsClientSecret,
  });

  // Verify channel exists
  console.log("\nVerifying channel...");
  try {
    const info = await getChannelInfo(client, options.teamsTeamId, options.teamsChannelId);
    console.log(`  Channel: ${info.displayName} (${info.membershipType})`);
  } catch (err) {
    console.error(
      `Failed to access channel: ${err instanceof Error ? err.message : err}`
    );
    process.exitCode = 1;
    return;
  }

  // Call completeMigration
  console.log("Calling completeMigration to unlock channel...");
  try {
    await completeMigration(client, options.teamsTeamId, options.teamsChannelId);
    console.log("\n\u2713 Channel unlocked successfully.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not in migration") || msg.includes("BadRequest")) {
      console.log("\n\u2713 Channel is not in migration mode (already unlocked).");
    } else {
      console.error(`\n\u2717 Failed to unlock channel: ${msg}`);
      process.exitCode = 1;
      return;
    }
  }

  // Update state file if provided
  if (options.stateFile) {
    try {
      const data = await fs.readFile(options.stateFile, "utf-8");
      const state = JSON.parse(data) as MigrationState;
      if (state.migrationModeActive) {
        state.migrationModeActive = false;
        state.stats.lastUpdatedAt = new Date().toISOString();
        await fs.writeFile(options.stateFile, JSON.stringify(state, null, 2), "utf-8");
        console.log(`  Updated state file: migrationModeActive = false`);
      }
    } catch {
      // State file doesn't exist or isn't readable - that's fine
    }
  }
}
