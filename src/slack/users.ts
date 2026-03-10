import { SlackClient } from "./client";
import { logger } from "../utils/logger";

export class SlackUserResolver {
  private cache = new Map<string, string>();
  private client: SlackClient;

  constructor(client: SlackClient) {
    this.client = client;
  }

  async resolve(userId: string): Promise<string> {
    if (this.cache.has(userId)) {
      return this.cache.get(userId)!;
    }

    try {
      const result = await this.client.limiter.schedule(() =>
        this.client.web.users.info({ user: userId })
      );

      const displayName =
        result.user?.profile?.display_name ||
        result.user?.real_name ||
        result.user?.name ||
        userId;

      this.cache.set(userId, displayName);
      return displayName;
    } catch (err) {
      logger.warn(`Failed to resolve user ${userId}: ${err}`);
      this.cache.set(userId, userId);
      return userId;
    }
  }

  async resolveAll(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    for (const id of unique) {
      await this.resolve(id);
    }
    return new Map(this.cache);
  }

  getDisplayName(userId: string): string {
    return this.cache.get(userId) ?? userId;
  }
}
