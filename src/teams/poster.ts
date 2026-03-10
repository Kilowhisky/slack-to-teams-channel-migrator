import { TeamsClient } from "./client";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import type { TeamsMessagePayload } from "../state/types";

export interface PostMessageResult {
  id: string;
}

export async function postMigrationMessage(
  client: TeamsClient,
  teamId: string,
  channelId: string,
  payload: TeamsMessagePayload
): Promise<PostMessageResult> {
  const result = await client.limiter.schedule(() =>
    withRetry(async () => {
      const response = await client.graph
        .api(`/teams/${teamId}/channels/${channelId}/messages`)
        .post(payload);
      return response;
    })
  );

  logger.debug(`Posted message, Teams ID: ${result.id}`);
  return { id: result.id };
}

export async function postMigrationReply(
  client: TeamsClient,
  teamId: string,
  channelId: string,
  parentMessageId: string,
  payload: TeamsMessagePayload
): Promise<PostMessageResult> {
  const result = await client.limiter.schedule(() =>
    withRetry(async () => {
      const response = await client.graph
        .api(
          `/teams/${teamId}/channels/${channelId}/messages/${parentMessageId}/replies`
        )
        .post(payload);
      return response;
    })
  );

  logger.debug(`Posted reply, Teams ID: ${result.id}`);
  return { id: result.id };
}
