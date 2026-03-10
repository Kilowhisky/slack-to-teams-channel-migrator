import { TeamsClient } from "./client";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

export async function startMigration(
  client: TeamsClient,
  teamId: string,
  channelId: string
): Promise<void> {
  logger.info("Starting migration mode on Teams channel (channel will be locked)...");

  await withRetry(async () => {
    await client.graph
      .api(`/teams/${teamId}/channels/${channelId}/startMigration`)
      .post({});
  });

  logger.info("Migration mode active. Channel is now locked for message import.");
}

export async function completeMigration(
  client: TeamsClient,
  teamId: string,
  channelId: string
): Promise<void> {
  logger.info("Completing migration (unlocking channel)...");

  await withRetry(async () => {
    await client.graph
      .api(`/teams/${teamId}/channels/${channelId}/completeMigration`)
      .post({});
  });

  logger.info("Migration completed. Channel is now unlocked.");
}

export async function getChannelInfo(
  client: TeamsClient,
  teamId: string,
  channelId: string
): Promise<{ displayName: string; membershipType: string }> {
  const channel = await client.graph
    .api(`/teams/${teamId}/channels/${channelId}`)
    .get();

  return {
    displayName: channel.displayName,
    membershipType: channel.membershipType || "standard",
  };
}
